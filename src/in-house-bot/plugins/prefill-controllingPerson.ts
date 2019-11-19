import uniqBy from 'lodash/uniqBy'
import extend from 'lodash/extend'

import {
  Bot,
  Logger,
  CreatePlugin,
  Applications,
  ISMS,
  IPBApp,
  IPluginLifecycleMethods,
  ValidatePluginConf,
  ITradleObject
} from '../types'
import * as Templates from '../templates'
import Errors from '../../errors'
import { TYPE } from '../../constants'
import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

import { hasPropertiesChanged } from '../utils'
// import { compare } from '@tradle/dynamodb/lib/utils'

const CORPORATION_EXISTS = 'tradle.CorporationExistsCheck'
const BENEFICIAL_OWNER_CHECK = 'tradle.BeneficialOwnerCheck'
const CLIENT_ACTION_REQUIRED_CHECK = 'tradle.ClientActionRequiredCheck'
const NEXT_FORM_REQUEST = 'tradle.NextFormRequest'
const CONTROLLING_PERSON = 'tradle.legal.LegalEntityControllingPerson'
const CHECK_STATUS = 'tradle.Status'
const COUNTRY = 'tradle.Country'

const countryMap = {
  England: 'United Kingdom',
  'England And Wales': 'United Kingdom'
}

export const createPlugin: CreatePlugin<void> = (components, pluginOpts) => {
  let { bot, applications, commands } = components
  let { logger, conf } = pluginOpts
  const plugin: IPluginLifecycleMethods = {
    async willRequestForm({ req, application, formRequest }) {
      let { form } = formRequest
      if (form !== CONTROLLING_PERSON) return

      // debugger
      if (!application) return

      let { checks } = application
      if (!checks) return

      let stubs = checks.filter(
        check =>
          check[TYPE] === CORPORATION_EXISTS ||
          check[TYPE] === BENEFICIAL_OWNER_CHECK ||
          check[TYPE] === CLIENT_ACTION_REQUIRED_CHECK
      )
      if (!stubs.length) return
      logger.debug('found ' + stubs.length + ' checks')
      let result = await Promise.all(stubs.map(check => bot.getResource(check)))

      result.sort((a, b) => b._time - a._time)

      result = uniqBy(result, TYPE)
      let check = result.find(c => c[TYPE] === CORPORATION_EXISTS)
      let pscCheck = result.find(c => c[TYPE] === BENEFICIAL_OWNER_CHECK)
      let carCheck = result.find(c => c[TYPE] === CLIENT_ACTION_REQUIRED_CHECK)

      let forms = application.forms.filter(form => form.submission[TYPE] === CONTROLLING_PERSON)
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

        return
      }

      officers =
        check.rawData &&
        check.rawData.length &&
        check.rawData[0].company &&
        check.rawData[0].company.officers

      if (officers.length)
        officers = officers.filter(o => o.officer.position !== 'agent' && !o.officer.inactive)

      let officer
      if (!forms.length) {
        officer = officers.length && officers[0].officer
      } else {
        items = await Promise.all(forms.map(f => bot.getResource(f.submission)))
        if (items.length) {
          for (let i = 0; i < officers.length && !officer; i++) {
            let o = officers[i].officer
            // if (o.inactive) continue
            let oldOfficer = items.find(
              item => o.name.toLowerCase().trim() === (item.name && item.name.toLowerCase().trim())
            )
            if (!oldOfficer) officer = o
          }
        }
      }
      if (!officer) {
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
        return
      }
      let { name, inactive, start_date, end_date, occupation, position } = officer
      let prefill: any = {
        name,
        startDate: start_date && new Date(start_date).getTime(),
        inactive,
        occupation,
        position,
        endDate: end_date && new Date(end_date).getTime()
      }
      this.findAndPrefillBeneficialOwner(pscCheck, officer, prefill)

      prefill = sanitize(prefill).sanitized

      if (!formRequest.prefill) formRequest.prefill = { [TYPE]: CONTROLLING_PERSON }
      formRequest.prefill = {
        ...formRequest.prefill,
        ...prefill,
        typeOfControllingEntity: {
          id: 'tradle.legal.TypeOfControllingEntity_person'
        }
      }
      formRequest.message = `Please review and correct the data below **for ${officer.name}**` //${bot.models[CONTROLLING_PERSON].title}: ${officer.name}`
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
      let bo = beneficialOwners.find(bo => this.compare(officer.name, bo))
      if (!bo) return
      this.prefillIndividual(prefill, bo)
    },

    compare(officerName, bo) {
      let { name, name_elements } = bo.data
      if (!name && !name_elements) return false
      officerName = officerName.toLowerCase().trim()
      if (name_elements) {
        let nameElms: any = {}
        for (let p in name_elements) nameElms[p] = name_elements[p].toLowerCase()
        let { forename, surname, middle_name } = nameElms
        if (
          officerName.indexOf(`${forename} `) === -1 ||
          officerName.indexOf(` ${surname}`) === -1 ||
          (middle_name && officerName.indexOf(` ${middle_name} `) === -1)
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
      let { country_of_residence, date_of_birth, natures_of_control } = bo.data

      prefill.dateOfBirth =
        date_of_birth && new Date(date_of_birth.year, date_of_birth.month).getTime()
      if (country_of_residence) {
        let country = getCountryByTitle(country_of_residence, bot.models)
        if (country) prefill.controllingEntityCountry = country
      }
      this.addNatureOfControl(prefill, natures_of_control)
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
          controllingEntityRegion: locality
        })
      }
      if (identification) {
        let {
          registration_number,
          legal_authority,
          legal_form,
          country_registered,
          place_registered
        } = identification
        extend(prefill, {
          controllingEntityCompanyNumber: registration_number,
          companyType: legal_form
        })
      }
      this.addNatureOfControl(prefill, natures_of_control)
    },
    addNatureOfControl(prefill, natures_of_control) {
      if (!natures_of_control) return
      let natureOfControl = bot.models['tradle.PercentageOfOwnership'].enum.find(e =>
        natures_of_control.includes(e.title.toLowerCase().replace(/\s/g, '-'))
      )
      if (natureOfControl)
        prefill.natureOfControl = {
          id: `tradle.PercentageOfOwnership_${natureOfControl.id}`,
          title: natureOfControl.title
        }
    },
    async prefillBeneficialOwner({ items, forms, officers, formRequest, pscCheck }) {
      if (!items) items = await Promise.all(forms.map(f => bot.getResource(f.submission)))
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

        if (items.find(item => item.name === name)) continue

        let isIndividual = kind.startsWith('individual')
        if (isIndividual) {
          // const prefixes = ['mr', 'ms', 'dr', 'mrs', ]
          if (officers && officers.length) {
            let boName = name.toLowerCase().trim()
            if (officers.find(o => this.compare(o.officer.name, bene))) continue
          }
        } else if (!kind.startsWith('corporate-')) return
        let prefill: any = {
          name
        }
        if (isIndividual) {
          this.prefillIndividual(prefill, bene)
          // prefill.dateOfBirth =
          //   date_of_birth && new Date(date_of_birth.year, date_of_birth.month).getTime()
          // if (country_of_residence) {
          //   let country = getCountryByTitle(country_of_residence, bot.models)
          //   if (country) prefill.controllingEntityCountry = country
          // }
        } else {
          this.prefillCompany(prefill, bene)
          if (formRequest.prefill) prefill.owns = formRequest.prefill.legalEntity
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
        formRequest.message = `Please review and correct the data below **for ${name}**` //${bot.models[CONTROLLING_PERSON].title}: ${officer.name}`
        return true
      }
    }
  }

  return {
    plugin
  }
}
function getCountryByTitle(country, models) {
  let mapCountry = countryMap[country]
  if (mapCountry) country = mapCountry
  let countryR = models[COUNTRY].enum.find(val => val.title === country)
  return (
    countryR && {
      id: `${COUNTRY}_${countryR.id}`,
      title: country
    }
  )
}
// const beneTest = [
//   {
//     company_number: '06415759',
//     data: {
//       address: {
//         address_line_1: '1 Goose Green',
//         country: 'England',
//         locality: 'Altrincham',
//         postal_code: 'WA14 1DW',
//         premises: 'Corpacq House'
//       },
//       etag: 'e5e6a05c5484ce25fca9884bb833d47c1fb1e0b4',
//       identification: {
//         country_registered: 'England',
//         legal_authority: 'Companies Act 2006',
//         legal_form: 'Private Company Limited By Shares',
//         place_registered: 'Register Of Companies For England And Wales',
//         registration_number: '11090838'
//       },
//       kind: 'corporate-entity-person-with-significant-control',
//       links: {
//         self:
//           '/company/06415759/persons-with-significant-control/corporate-entity/c3JdMtrhD9Z17jLydOWsp6YVh9w'
//       },
//       name: 'Beyondnewcol Limited',
//       natures_of_control: [
//         'ownership-of-shares-75-to-100-percent',
//         'voting-rights-75-to-100-percent',
//         'right-to-appoint-and-remove-directors'
//       ],
//       notified_on: '2019-06-27'
//     }
//   },
//   {
//     company_number: '12134701',
//     data: {
//       address: {
//         address_line_1: 'Bell Yard',
//         country: 'United Kingdom',
//         locality: 'London',
//         postal_code: 'WC2A 2JR',
//         premises: '7'
//       },
//       country_of_residence: 'United Kingdom',
//       date_of_birth: {
//         month: 3,
//         year: 1966
//       },
//       etag: 'a46e27e4284b75c2a6a2b6a122df6b1abee4e13d',
//       kind: 'individual-person-with-significant-control',
//       links: {
//         self:
//           '/company/12134701/persons-with-significant-control/individual/fXEREOeTBLPNqrAK3ylzPr3w73Q'
//       },
//       name: 'Miss Joana Castellet',
//       name_elements: {
//         forename: 'Joana',
//         surname: 'Castellet',
//         title: 'Miss'
//       },
//       nationality: 'Spanish',
//       natures_of_control: [
//         'ownership-of-shares-75-to-100-percent',
//         'voting-rights-75-to-100-percent',
//         'right-to-appoint-and-remove-directors'
//       ],
//       notified_on: '2019-08-01'
//     }
//   }
// ]