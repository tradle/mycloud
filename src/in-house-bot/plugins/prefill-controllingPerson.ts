import uniqBy from 'lodash/uniqBy'
import extend from 'lodash/extend'
import size from 'lodash/size'
import cleanco from 'cleanco'

import { Bot, Logger, CreatePlugin, IPluginLifecycleMethods, IPBReq } from '../types'

import { TYPE } from '../../constants'
import validateResource from '@tradle/validate-resource'
import { enumValue } from '@tradle/build-resource'
import { regions } from '@tradle/aws-s3-client'
import { getEnumValueId } from '../../utils'
import { isSubClassOf, getCheckParameters } from '../utils'
// @ts-ignore
const { sanitize } = validateResource.utils

const CORPORATION_EXISTS = 'tradle.CorporationExistsCheck'
const BENEFICIAL_OWNER_CHECK = 'tradle.BeneficialOwnerCheck'
const CLIENT_ACTION_REQUIRED_CHECK = 'tradle.ClientActionRequiredCheck'
const REFERENCE_DATA_SOURCES = 'tradle.ReferenceDataSources'
const CONTROLLING_PERSON = 'tradle.legal.LegalEntityControllingPerson'
const LEGAL_ENTITY = 'tradle.legal.LegalEntity'
const CHECK_STATUS = 'tradle.Status'
const ENUM = 'tradle.Enum'
const TYPE_OF_OWNERSHIP = 'tradle.legal.TypeOfOwnership'
const COUNTRY = 'tradle.Country'
const COMPANIES_HOUSE = 'Companies House'
const OPEN_CORPORATES = 'Open Corporates'
const REFRESH_PRODUCT = 'tradle.RefreshProduct'
const FORM_REQUEST = 'tradle.FormRequest'
const DATA_BUNDLE_SUBMITTED = 'tradle.DataBundleSubmitted'
const DATA_BUNDLE = 'tradle.DataBundle'

const companyKeywords = {
  DE: ['GmbH', 'HRB'],
  US: ['INCORP', 'SERVICES']
}

const countryMap = {
  England: 'United Kingdom',
  'England And Wales': 'United Kingdom'
}

export const createPlugin: CreatePlugin<void> = (components, pluginOpts) => {
  let { bot, applications } = components
  let { logger, conf } = pluginOpts
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req: IPBReq) {
      if (req.skipChecks) return
      const { user, application, payload } = req
      if (!application  ||  application.requestFor !== REFRESH_PRODUCT) return

      let ptype = payload[TYPE]
      let isDataBundleSubmitted = ptype === DATA_BUNDLE_SUBMITTED
      if (!isDataBundleSubmitted && ptype !== CONTROLLING_PERSON) return

      const { submissions } = application
      if (!submissions.find(sub => sub.submission[TYPE] === LEGAL_ENTITY)) return
      let dataBundleLink
      if (ptype === CONTROLLING_PERSON) {
        let dbs = submissions.find(sub => sub.submission[TYPE] === DATA_BUNDLE_SUBMITTED)
        if (!dbs) return
        dbs = await bot.getResource(dbs.submission)
        dataBundleLink = dbs.dataBundle
      }
      else
        dataBundleLink = payload.dataBundle
      if (!dataBundleLink) return
      let dataBundle = await bot.db.findOne({
        filter: {
          EQ: {
            [TYPE]: DATA_BUNDLE,
            _permalink: dataBundleLink
          }
        }
      })
      let { items } = dataBundle
      if (!items || !items.length) return
      let cpInBundleCount = items.reduce((n, item) => item[TYPE] === CONTROLLING_PERSON ? n + 1 : n, 0)
      if (cpInBundleCount) {
        let cpInAppCount = submissions.reduce((n, item) => item.submission[TYPE] === CONTROLLING_PERSON ? n + 1 : n, 0)
        if (!isDataBundleSubmitted)
          cpInAppCount++
        if (cpInBundleCount > cpInAppCount) return
      }
      let formRequest:any = {[TYPE]: FORM_REQUEST, form: CONTROLLING_PERSON, product: REFRESH_PRODUCT}
      await this.getCP({ application, formRequest, req: !isDataBundleSubmitted && req })
      if (!formRequest.prefill) {
        await bot.sendSimpleMessage({
          to: user,
          message: 'You submitted all of the Controlling Entities'
        });
        return
      }
      await applications.requestItem({
        item: formRequest,
        application,
        req,
        user,
        message: 'Please review and confirm'
      })
    },
    async willRequestForm({ application, formRequest }) {
      let { form } = formRequest
      if (form !== CONTROLLING_PERSON) return

      // debugger
      if (!application) return

      let { checks } = application
      if (!checks) return

      if (application.requestFor !== REFRESH_PRODUCT)
        await this.getCP({ application, formRequest })
    },
    async getCP({ application, formRequest, req }) {
      let checks = application.checks
      let stubs = checks.filter(
        (check) =>
          check[TYPE] === CORPORATION_EXISTS ||
          check[TYPE] === BENEFICIAL_OWNER_CHECK ||
          check[TYPE] === CLIENT_ACTION_REQUIRED_CHECK
      )
      if (!stubs.length) return
      logger.debug('found ' + stubs.length + ' checks')
      let result:any = await Promise.all(stubs.map((check) => bot.getResource(check)))
      result = result.filter((check) => !check.isInactive)
      result.sort((a, b) => b._time - a._time)

      result = uniqBy(result, (r: any) =>
        [r.form._permalink, r.propertyName, r[TYPE], r.provider].join(',')
      )

      let legalEntity = application.forms.find((f) => f.submission[TYPE] === LEGAL_ENTITY).submission
      let legalEntityPermalink = legalEntity._permalink
      let check = result.find(
        (c) => c[TYPE] === CORPORATION_EXISTS && c.form._permalink === legalEntityPermalink
      )
      let pscCheck = result.find(
        (c) =>
          c[TYPE] === BENEFICIAL_OWNER_CHECK &&
          c.provider === 'http://download.companieshouse.gov.uk/en_pscdata.html'
      )
      let pitchbookCheck = result.find(
        (c) =>
          c[TYPE] === BENEFICIAL_OWNER_CHECK &&
          c.provider === 'PitchBook Data, Inc.' &&
          c.form._permalink === legalEntityPermalink
      )
      let carCheck = result.find((c) => c[TYPE] === CLIENT_ACTION_REQUIRED_CHECK)
      const statusM = bot.models[CHECK_STATUS]
      let forms = application.forms.filter((form) => form.submission[TYPE] === CONTROLLING_PERSON)
      if (!check) return
      let officers, items
      if (check.status.id !== `${CHECK_STATUS}_pass`) {
        if (pscCheck && pscCheck.status.id === `${CHECK_STATUS}_pass`)
          await this.prefillBeneficialOwner({ items, forms, officers, formRequest, pscCheck })
        if (carCheck && carCheck.status.id === `${CHECK_STATUS}_pass`)
          await this.prefillBeneficialOwner({
            items,
            forms,
            officers,
            formRequest,
            pscCheck: carCheck
          })

        if (
          !pscCheck &&
          pitchbookCheck &&
          getEnumValueId({ model: statusM, value: pitchbookCheck.status }) === 'pass'
        )
          await this.prefillBeneficialOwner({ items, forms, officers, formRequest, pitchbookCheck })
        return
      }

      officers =
        check.rawData &&
        check.rawData.length &&
        check.rawData[0].company &&
        check.rawData[0].company.officers

      if (!officers) officers = []
      if (officers.length)
        officers = officers.filter((o) => o.officer.position !== 'agent' && !o.officer.inactive)

      let officer
      if (!forms.length) {
        officer = officers.length && officers[0].officer
      } else {
        items = await Promise.all(forms.map((f) => bot.getResource(f.submission)))
        if (req)
          items.push(req.payload)
        if (items.length) {
          for (let i = 0; i < officers.length && !officer; i++) {
            let o = officers[i].officer
            // if (o.inactive) continue
            let oldOfficer = items.find((item) => {
              let oname = o.name.toLowerCase().trim()
              let iname = item.name && item.name.toLowerCase().trim()
              let pname = item.prefilledName && item.prefilledName.toLowerCase().trim()
              return oname === iname || oname === pname
            })
            // debugger
            if (!oldOfficer) officer = o
          }
        }
      }
      legalEntity = await bot.getResource(legalEntity)
      let dataSource
      if (!officer) {
        if (await this.doSkipBO(application)) return
        let found
        if (pscCheck && pscCheck.status.id === `${CHECK_STATUS}_pass`) {
          let currenPrefill = { ...formRequest.prefill }
          found = await this.prefillBeneficialOwner({
            items,
            forms,
            officers,
            formRequest,
            pscCheck,
            legalEntity
          })
          dataSource = 'psc'
          this.addRefDataSource({ dataSource, formRequest, currenPrefill })
        } else if (carCheck && carCheck.status.id === `${CHECK_STATUS}_pass`) {
          // let currenPrefill = formRequest.prefill
          found = await this.prefillBeneficialOwner({
            items,
            forms,
            officers,
            formRequest,
            pscCheck: carCheck,
            legalEntity
          })
          dataSource = 'clientAction'
          // this.addRefDataSource({ dataSource: 'clientAction', formRequest, currenPrefill })
        }
        if (
          !found &&
          pitchbookCheck &&
          getEnumValueId({ model: statusM, value: pitchbookCheck.status }) === 'pass'
        ) {
          dataSource = 'pitchbook.fund'
          let currenPrefill = { ...formRequest.prefill }
          await this.prefillBeneficialOwner({
            items,
            forms,
            officers,
            formRequest,
            pscCheck: pitchbookCheck,
            legalEntity
          })
          this.addRefDataSource({ dataSource, formRequest, currenPrefill })
        }
        return
      }
      let {
        name,
        inactive,
        start_date,
        identification,
        end_date,
        occupation,
        position,
        nationality,
        country_of_residence,
        date_of_birth
      } = officer
      let prefill: any = {
        name,
        prefilledName: name,
        startDate: start_date && new Date(start_date).getTime(),
        inactive,
        occupation,
        position,
        endDate: end_date && new Date(end_date).getTime()
      }
      let isCompany
      if (!date_of_birth && !country_of_residence) {
        if (identification && identification.registration_number) isCompany = true
        else {
          let le = await bot.getResource(legalEntity.submission)
          isCompany = this.isCompany({
            name,
            country: le.country
          })
        }
      }
      if (isCompany || (identification && identification.registration_number)) {
        this.prefillCompany(prefill, { data: officer })
        prefill.doNotReachOut = true
        prefill = sanitize(prefill).sanitized
        if (!formRequest.prefill) formRequest.prefill = { [TYPE]: CONTROLLING_PERSON }
        formRequest.prefill = {
          ...formRequest.prefill,
          ...prefill,
          typeOfControllingEntity: {
            id: 'tradle.legal.TypeOfControllingEntity_legalEntity'
          }
        }
        logger.debug('prefill = ' + formRequest.prefill)
        if (formRequest.product === REFRESH_PRODUCT)
          formRequest.message = `Your company’s profile is missing the following controlling person, found in a primary data source **${name}**` //${bot.models[CONTROLLING_PERSON].title}: ${officer.name}`
        else
          formRequest.message = `Please review and correct the data below **for ${name}**` //${bot.models[CONTROLLING_PERSON].title}: ${officer.name}`
        return
      }
      if (country_of_residence) {
        let country = getCountryByTitle(country_of_residence, bot.models)
        if (country) prefill.controllingEntityCountryOfResidence = country
      }
      if (nationality) {
        nationality = this.getNationality(nationality, prefill.controllingEntityCountryOfResidence)
        if (nationality)
          prefill.nationality = nationality
        else if (country_of_residence)
          prefill.nationality = prefill.controllingEntityCountryOfResidence
      }
      if (date_of_birth)
        prefill.controllingEntityDateOfBirth =
          date_of_birth && new Date(date_of_birth.year, date_of_birth.month - 1).getTime()

      if (check.provider === COMPANIES_HOUSE) {
        let [lastName, otherNames] = name.split(', ')
        if (otherNames) {
          let names = otherNames && otherNames.trim().split(' ')
          let firstName
          let middleName
          let len = names.length
          if (len !== 1) {
            middleName = names[len - 1]
            firstName = names
              .slice(0, len - 1)
              .join(' ')
              .trim()
          } else firstName = names[0].trim()

          extend(prefill, { firstName, lastName, middleName })
        }
      } else if (check.provider === OPEN_CORPORATES) {
        let parts = name.split(' ')
        let lastName = parts[parts.length - 1]
        let middleName
        if (parts.length > 2) middleName = parts[parts.length - 2]
        let firstName
        if (parts.length <= 3) firstName = parts[0]
        else firstName = parts.slice(0, parts.length - 2).join(' ')
        extend(prefill, { firstName, lastName, middleName })
      }

      let cePrefill = { ...prefill }
      cePrefill = sanitize(cePrefill).sanitized
      let provider = enumValue({
        model: bot.models[REFERENCE_DATA_SOURCES],
        // HACK
        value: (check.provider === 'Open Corporates' && 'openCorporates') || 'companiesHouse'
      })

      let dataLineage = {
        [provider.id]: {
          properties: Object.keys(cePrefill)
        }
      }
      this.findAndPrefillBeneficialOwner(pscCheck, officer, prefill)
      prefill = sanitize(prefill).sanitized
      if (size(prefill) !== size(cePrefill)) {
        let pscPrefill = []
        for (let p in prefill) {
          if (!cePrefill[p]) pscPrefill.push(p)
        }
        let pscProvider = enumValue({
          model: bot.models[REFERENCE_DATA_SOURCES],
          value: 'psc'
        })
        dataLineage = {
          ...dataLineage,
          [pscProvider.id]: {
            properties: pscPrefill
          }
        }
      }
      this.findAndPrefillBeneficialOwner(pitchbookCheck, officer, prefill)
      prefill = sanitize(prefill).sanitized
      if (size(prefill) !== size(cePrefill)) {
        let pitchbookPrefill = []
        for (let p in prefill) {
          if (!cePrefill[p]) pitchbookPrefill.push(p)
        }
        let pscProvider = enumValue({
          model: bot.models[REFERENCE_DATA_SOURCES],
          value: 'pitchbook.fund'
        })
        dataLineage = {
          ...dataLineage,
          [pscProvider.id]: {
            properties: pitchbookPrefill
          }
        }
      }
      if (!prefill.typeOfOwnership) {
        prefill.typeOfOwnership = enumValue({
          model: bot.models[TYPE_OF_OWNERSHIP],
          // HACK
          value: 'individual'
        })
      }
      await this.addOwnsTypeOfOwnership({ formRequest, prefill })

      formRequest.dataLineage = dataLineage
      if (!formRequest.prefill) formRequest.prefill = { [TYPE]: CONTROLLING_PERSON }
      formRequest.prefill = {
        ...formRequest.prefill,
        ...prefill,
        typeOfControllingEntity: {
          id: 'tradle.legal.TypeOfControllingEntity_person'
        }
      }
      if (formRequest.product === REFRESH_PRODUCT)
        formRequest.message = `Your company’s profile is missing the following controlling person, found in a primary data source **${officer.name}**` //${bot.models[CONTROLLING_PERSON].title}: ${officer.name}`
      else
        formRequest.message = `Please review and correct the data below **for ${officer.name}**` //${bot.models[CONTROLLING_PERSON].title}: ${officer.name}`

    },
    isCompany({ name, country }) {
      let tokens = name.replace(/[^\w\s]/gi, '').split(' ')
      let clean = cleanco.clean(name.replace(/\./g, ''))
      if (tokens.length !== clean.length) {
        debugger
        // return true
      }
      let id = getEnumValueId({ model: bot.models[COUNTRY], value: country })
      let keys = companyKeywords[id]
      if (!keys) return false

      return keys.filter((key) => tokens.includes(key) || !isNaN(key)).length
    },
    async doSkipBO(application) {
      let pconf = conf && conf[application.requestFor]
      if (!pconf) return false
      let { skipBo } = pconf
      if (!skipBo) return false

      let forms = Object.keys(skipBo)
      let cforms: any = application.forms.filter((f) => forms.includes(f.submission[TYPE]))
      if (!cforms.length) return false

      cforms = await Promise.all(cforms.map((f) => bot.getResource(f.submission)))
      cforms.sort((a, b) => b._time - a._time)
      cforms = uniqBy(cforms, '_permalink')

      let { models } = bot
      for (let i = 0; i < cforms.length; i++) {
        let f = cforms[i]
        let conditions = skipBo[f[TYPE]]
        let props = models[f[TYPE]].properties
        if (!this.checkCondition(conditions, props, f)) return false
      }
      return true
    },
    checkCondition(conditions, props, form) {
      let { models } = bot
      for (let p in conditions) {
        if (!(p in form)) return false

        let condition = conditions[p]
        let val = form[p]
        let { type, ref } = props[p]

        if (type === 'array') return false

        if (type !== 'object') {
          if (type === 'string') {
            if (form[p].toLowerCase() !== condition.toLowerCase()) return false
          } else if (form[p] !== condition) return false
          continue
        }
        if (!isSubClassOf(ENUM, models[ref], models)) return false
        let eid = getEnumValueId({ model: models[ref], value: form[p] })
        if (typeof condition === 'string') {
          if (eid !== val) return false
        } else if (!condition.includes(eid)) return false
      }
      return true
    },
    addRefDataSource({ dataSource, currenPrefill, formRequest }) {
      let { prefill } = formRequest
      if (size(prefill) === size(currenPrefill)) return
      let dsPrefill = []
      for (let p in prefill) if (!currenPrefill[p]) dsPrefill.push(p)

      let eVal = enumValue({
        model: bot.models[REFERENCE_DATA_SOURCES],
        value: dataSource
      })
      if (!formRequest.dataLineage) formRequest.dataLineage = {}
      formRequest.dataLineage = {
        ...formRequest.dataLineage,
        [eVal.id]: {
          properties: dsPrefill
        }
      }
    },
    findAndPrefillBeneficialOwner(pscCheck, officer, prefill) {
      let beneficialOwners = pscCheck && pscCheck.rawData
      if (!beneficialOwners || !beneficialOwners.length) return
      if (beneficialOwners.length > 1) {
        // debugger
        beneficialOwners.sort(
          (a, b) => new Date(b.data.notified_on).getTime() - new Date(a.data.notified_on).getTime()
        )
        beneficialOwners = uniqBy(beneficialOwners, 'data.name')
      }
      let bo = beneficialOwners.find((bo) => this.compare(officer.name, bo))
      if (!bo) return
      this.prefillIndividual(prefill, bo)
      return true
    },

    compare(officerName, bo) {
      officerName = officerName
        .replace(/[^a-zA-Z ]/g, '')
        .toLowerCase()
        .trim()
      let officerNameDetails = officerName.split(' ')

      let { name, name_elements } = bo.data
      if (!name && !name_elements) return false
      if (name_elements) {
        let nameElms: any = {}
        for (let p in name_elements) nameElms[p] = name_elements[p].toLowerCase()
        let { forename, surname, middle_name } = nameElms
        if (
          !officerNameDetails.includes(`${forename}`) ||
          !officerNameDetails.includes(`${surname}`) ||
          (middle_name && !officerNameDetails.includes(`${middle_name}`))
        )
          return false
        else return true
      }
      name = name.toLowerCase().trim()
      let idx = name.indexOf(officerName)
      if (idx !== -1) {
        if (name.length === officerName.length) return true
        if (idx && name.charAt(idx - 1) === ' ' && idx + officerName.length === name.length)
          return true
      }
    },
    prefillIndividual(prefill, bo) {
      let {
        country_of_residence,
        date_of_birth,
        natures_of_control,
        name_elements,
        nationality
      } = bo.data

      prefill.controllingEntityDateOfBirth =
        date_of_birth && new Date(date_of_birth.year, date_of_birth.month - 1).getTime()
      if (country_of_residence) {
        let country = getCountryByTitle(country_of_residence, bot.models)
        if (country) {
          prefill.controllingEntityCountryOfResidence = country
          prefill.nationality = country
        }
      }
      if (nationality) {
        nationality = this.getNationality(nationality, prefill.controllingEntityCountryOfResidence)
        if (nationality)
          prefill.nationality = nationality
      }
      if (name_elements) {
        let { firstName, lastName } = prefill
        if (!firstName && !lastName) {
          extend(prefill, {
            firstName: name_elements.forename,
            lastName: name_elements.surname,
            middleName: name_elements.middle_name
          })
        }
      }
      prefill.typeOfOwnership = enumValue({
        model: bot.models[TYPE_OF_OWNERSHIP],
        // HACK
        value: 'individual'
      })

      this.addNatureOfControl(prefill, natures_of_control)
    },
    getNationality(nationality, countryOfResidence) {
      let model = bot.models[COUNTRY]
      let items = model.enum.filter((c) => c.nationality === nationality)
      if (!items || !items.length) return
      if (items.length === 1) return enumValue({ model, value: items[0].id })
      else {
        let cid = getEnumValueId({ model: bot.models[COUNTRY], value: countryOfResidence })
        let item = items.find((item) => item.id === cid)
        return enumValue({ model, value: item.id })
      }
    },
    prefillCompany(prefill, bo) {
      let { address, identification, position, occupation, natures_of_control } = bo.data

      prefill.occupation = occupation || position
      if (address) {
        let { country, locality, postal_code, address_line_1 } = address
        if (country) {
          country = getCountryByTitle(country, bot.models)
          if (country) prefill.controllingEntityCountry = country
        }
        extend(prefill, {
          controllingEntityPostalCode: postal_code,
          controllingEntityStreetAddress: address_line_1,
          // controllingEntityRegion: regions,
          controllingEntityCity: locality
        })
      }
      if (identification) {
        let {
          registration_number,
          legal_authority,
          // legal_form,
          country_registered,
          place_registered
        } = identification
        extend(prefill, {
          controllingEntityCompanyNumber: registration_number
          // companyType: legal_form
        })
        if (place_registered && !prefill.controllingEntityCountry) {
          let country = getCountryByTitle(place_registered, bot.models)
          if (country) prefill.controllingEntityCountry = country
        }
      }
      this.addNatureOfControl(prefill, natures_of_control)
    },
    addNatureOfControl(prefill, natures_of_control) {
      if (!natures_of_control) return
      let natureOfControl = bot.models['tradle.PercentageOfOwnership'].enum.find((e) =>
        natures_of_control.includes(e.id.replace(/\./g, '-'))
      )
      if (natureOfControl)
        prefill.natureOfControl = {
          id: `tradle.PercentageOfOwnership_${natureOfControl.id}`,
          title: natureOfControl.title
        }
    },
    async prefillBeneficialOwner({ items, forms, officers, formRequest, pscCheck, legalEntity }) {
      if (!items) items = await Promise.all(forms.map((f) => bot.getResource(f.submission)))
      if (!pscCheck) return

      if (pscCheck.status.id !== `${CHECK_STATUS}_pass`) return
      let beneficialOwners = pscCheck.rawData && pscCheck.rawData
      logger.debug(
        'pscCheck.rawData: ' +
          beneficialOwners +
          '; ' +
          JSON.stringify(beneficialOwners[0], null, 2) +
          '; length = ' +
          beneficialOwners.length
      )

      if (!beneficialOwners || !beneficialOwners.length) return

      if (beneficialOwners.length > 1) {
        // debugger
        beneficialOwners.sort(
          (a, b) => new Date(b.data.notified_on).getTime() - new Date(a.data.notified_on).getTime()
        )
        beneficialOwners = uniqBy(beneficialOwners, 'data.name')
      }
      for (let i = 0; i < beneficialOwners.length; i++) {
        let bene = beneficialOwners[i]
        let { data } = bene
        let { name, kind, ceased_on } = data
        if (ceased_on) continue
        // debugger
        logger.debug('name = ' + name)

        if (items.find((item) => item.name === name || item.prefilledName === name)) continue

        let isIndividual = kind.startsWith('individual')
        if (isIndividual) {
          // const prefixes = ['mr', 'ms', 'dr', 'mrs', ]
          if (officers && officers.length) {
            let boName = name.toLowerCase().trim()
            if (officers.find((o) => this.compare(o.officer.name, bene))) continue
          }
        } else if (!kind.startsWith('corporate-')) return
        else if (bene['company_number'] === legalEntity.registrationNumber)
          continue
        let prefill: any = {
          name,
          prefilledName: name
        }
        await this.addOwnsTypeOfOwnership({ formRequest, prefill })

        if (isIndividual) {
          this.prefillIndividual(prefill, bene)
        } else {
          this.prefillCompany(prefill, bene)
        }
        prefill = sanitize(prefill).sanitized
        if (!formRequest.prefill) formRequest.prefill = { [TYPE]: CONTROLLING_PERSON }
        formRequest.prefill = {
          ...formRequest.prefill,
          ...prefill,
          typeOfControllingEntity: {
            id: kind.startsWith('individual')
              ? 'tradle.legal.TypeOfControllingEntity_person'
              : 'tradle.legal.TypeOfControllingEntity_legalEntity'
          }
        }
        logger.debug('prefill = ' + formRequest.prefill)
        if (formRequest.product === REFRESH_PRODUCT)
          formRequest.message = `Your company’s profile is missing the following controlling person, found in a primary data source **${name}**` //${bot.models[CONTROLLING_PERSON].title}: ${officer.name}`
        else
          formRequest.message = `Please review and correct the data below **for ${name}**` //${bot.models[CONTROLLING_PERSON].title}: ${officer.name}`
        return true
      }
    },
    async addOwnsTypeOfOwnership({ formRequest, prefill }) {
      if (!formRequest.prefill || prefill.ownsTypeOfOwnership) return
      let legalEntityStub = formRequest.prefill.legalEntity
      if (!legalEntityStub) return
      prefill.owns = legalEntityStub
      let legalEntity = await bot.getResource(legalEntityStub)
      if (legalEntity.typeOfOwnership) prefill.ownsTypeOfOwnership = legalEntity.typeOfOwnership
    }
  }

  return {
    plugin
  }
}
function getCountryByTitle(country, models) {
  let mapCountry = countryMap[country]
  if (mapCountry) country = mapCountry
  let c = country.toUpperCase()
  let countryR = models[COUNTRY].enum.find((val) => val.title.toUpperCase() === c)
  return (
    countryR && {
      id: `${COUNTRY}_${countryR.id}`,
      title: countryR.title
    }
  )
}
