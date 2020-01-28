/**
 * Risk Rating follows the Credit score model
 * - it is a number between 1000 and 0, with 1000 being the least risky
 * - the pie is divided between the categories below.
 * - the weight of each category's pie slice and each factor's weight is defineed here:
 *   https://github.com/tradle/mycloud/blob/master/riskFactors.json
 * Note. Beneficial owners that are individuals are treated as officers of the company for now.
 *
 * -- Countries --
 * Officers: country of issue from PhotoID (should we look at nationaliy too?)
 * Beneficial owners entitites (bene): country of registration
 * final risk is the minimum of the company's and bene risks across the whole tree
 *
 * -- Length of relationship --
 * Officers:
 * 1. skip all inactive officers
 * 2. take length of employment from their company's government registration
 * 3. divide the influence over the 'length of relationship' pie across all officers
 * Bene: do not have a signal on that yet
 *
 * -- Industry --
 * 1. we use international classification ISIC code(s) from their government registration
 * 2. if more than one ISIC then we take the one with higher risk
 * 3. final risk is the minimum of the company's and bene risks
 *
 * -- Legal structure --
 * Public, private, partnership, etc.
 *
 * -- Sanctions and other exceptions
 * not taken into account yet
 *
 * finalScore = countriesScore + industryScore + sanctionsScore + peopleScore + legalStructureScore
 *
 ***/
import { uniqBy, size, extend } from 'lodash'
import { TYPE } from '@tradle/constants'

import { enumValue, buildResourceStub } from '@tradle/build-resource'

import { CreatePlugin, Bot, Applications, Logger, IPBApp } from '../types'
import { getEnumValueId, getFormStubs, getLatestChecks, isSubClassOf } from '../utils'

// const riskFactors = require('../../../riskFactors.json')

const CP_ONBOARDING = 'tradle.legal.ControllingPersonOnboarding'
const CE_CP = 'tradle.legal.LegalEntityControllingPerson'
const LE = 'tradle.legal.LegalEntity'
const CORPORATION_EXISTS = 'tradle.CorporationExistsCheck'

const SPECIAL_APPROVAL_REQUIRED_CHECK = 'tradle.SpecialApprovalRequiredCheck'
const SPECIAL_APPROVAL_REQUIRED_CHECK_OVERRIDE = 'tradle.SpecialApprovalRequiredCheckOverride'

const PRE_SPECIAL_APPROVAL_CHECK = 'tradle.PreSpecialApprovalCheck'
const PRE_SPECIAL_APPROVAL_CHECK_OVERRIDE = 'tradle.PreSpecialApprovalCheckOverride'

const RISK_CLASSIFICATION_CHECK = 'tradle.RiskClassificationCheck'
const STOCK_EXCHANGE = 'tradle.StockExchange'
const TYPE_OF_OWNERSHIP = 'tradle.legal.TypeOfOwnership'
const COUNTRY = 'tradle.Country'
// const BENEFICIAL_OWNER_CHECK = 'tradle.BeneficialOwnerCheck'
const STATUS = 'tradle.Status'
const SCORE_TYPE = 'tradle.ScoreType'
const BANK_ACCOUNT = 'tradle.BankAccount'
const AUTOHIGH = '*AUTOHIGH*'
const defaultMap = {
  countryOfResidence: 'countryOfResidence',
  countryOfRegistration: 'countryOfRegistration',
  countriesOfOperation: 'countriesOfOperation',
  countriesOfSignificantLink: 'countriesOfSignificantLink',
  countriesOfCitizenship: 'countriesOfCitizenship'
}

class RiskScoreAPI {
  private bot: Bot
  private logger: Logger
  private conf: any
  private applications: Applications
  private riskFactors: any
  constructor({ bot, conf, logger, applications }) {
    this.bot = bot
    this.conf = conf
    this.logger = logger
    this.applications = applications
    this.riskFactors = conf.riskFactors
  }
  public async getScore({ form, req, map, requestFor }) {
    let { application } = req
    const { models } = this.bot

    let countryOfResidence = form[map.countryOfResidence]
    let countryOfRegistration = form[map.countryOfRegistration]

    let countriesOfOperation = form[map.countriesOfOperation]
    let countriesOfSignificantLink = form[map.countriesOfSignificantLink]
    let countriesOfCitizenship = form[map.countriesOfCitizenship]

    let isCpOnboarding = requestFor === CP_ONBOARDING
    let isBO = form[TYPE] === CE_CP
    let scoreDetails: any = {
      form: buildResourceStub({ resource: form, models })
    }

    if (countryOfResidence || countryOfRegistration) {
      // Country of registration or residence
      let detail: any = this.checkCountry({ country: countryOfResidence || countryOfRegistration })
      if (isBO) {
        scoreDetails.beneficialOwnerRisk = detail
      } else if (isCpOnboarding) scoreDetails.countryOfResidence = detail
      else scoreDetails.countryOfRegistration = detail

      if (detail.risk) scoreDetails.risk = detail.risk
    }
    if (countriesOfCitizenship) {
      this.checkCountries({
        scoreDetails,
        countriesToCheck: countriesOfCitizenship,
        name: 'countriesOfCitizenship',
        category: 'Citizenship'
      })
    }

    if (isCpOnboarding) return scoreDetails

    if (countriesOfOperation)
      this.checkCountries({
        scoreDetails,
        countriesToCheck: countriesOfOperation,
        name: 'countriesOfOperation',
        category: 'Operations'
      })

    if (countriesOfSignificantLink)
      this.checkCountries({
        scoreDetails,
        countriesToCheck: countriesOfSignificantLink,
        name: 'countriesOfSignificantLink',
        category: 'Operations'
      })

    if (size(scoreDetails) === 1) return

    let { latestChecks, checks } = req
    if (!checks) ({ checks, latestChecks } = await getLatestChecks({ application, bot: this.bot }))
    if (!latestChecks || !latestChecks.length) return
    let permalink = form._permalink

    let checksForThisForm = latestChecks.filter(check => check.form._permalink === permalink)
    let corpExistsCheck = checksForThisForm.find(check => check[TYPE] === CORPORATION_EXISTS)
    if (
      corpExistsCheck &&
      getEnumValueId({ model: models[STATUS], value: corpExistsCheck.status }) !== 'pass'
    ) {
      debugger
      scoreDetails.companyNotFound = true
    }
    return scoreDetails
  }
  public async calcScore({ application, forms }: { application: IPBApp; forms?: any }) {
    let { scoreDetails } = application
    let { details, summary } = scoreDetails
    const { baseRisk, weights, transactionalRisk, historicalBehaviorRisk } = this.riskFactors

    extend(summary, {
      baseRisk: (baseRisk.default * weights.baseRisk) / 100,
      transactionalRisk: (transactionalRisk.default * weights.transactionalRisk) / 100,
      beneficialOwnersRisk: this.calcOneCategoryScore({ name: 'beneficialOwnerRisk', details }),
      countryOfRegistration: this.calcOneCategoryScore({ name: 'countryOfRegistration', details }),
      countriesOfOperation: this.calcOneCategoryScore({ name: 'countriesOfOperation', details })
    })
    let countriesOfSignificantLinkScore = this.calcOneCategoryScore({
      name: 'countriesOfSignificantLink',
      details
    })
    if (countriesOfSignificantLinkScore > summary.countriesOfOperation)
      summary.countriesOfOperation = countriesOfSignificantLinkScore

    let { countryOfRegistration, countriesOfOperation } = summary
    if (countriesOfOperation && countryOfRegistration) {
      let countriesOfOp = details.filter(
        d => d.countriesOfOperation || d.countriesOfSignificantLink
      )
      let countries = []
      if (countriesOfOp.length) {
        countriesOfOp.forEach(c => {
          let cc = c.countriesOfOperation || c.countriesOfSignificantLink
          countries = countries.concat(Object.keys(cc))
        })
      }
      if (countries.length) {
        if (countries.length > 2) summary.crossBorderRisk = weights.crossBorderRisk
        else {
          let legalEntity = forms && forms.find(d => d[TYPE] === LE)
          let countryReg = getEnumValueId({
            model: this.bot.models[COUNTRY],
            value: legalEntity.country
          })
          if (!countries.includes(countryReg)) summary.crossBorderRisk = weights.crossBorderRisk
        }
      }
    }
    if (!('crossBorderRisk' in summary)) summary.crossBorderRisk = 0
    summary.lengthOfRelationship = weights.lengthOfRelationship
    if (details && details.length) {
      let accounts = details.find(r => r.numberOfAccounts)
      if (accounts) summary.accountsType = accounts.score
    }

    let specialApprovalChecks =
      application.checks &&
      application.checks.filter(
        check =>
          check[TYPE] === SPECIAL_APPROVAL_REQUIRED_CHECK ||
          check[TYPE] === PRE_SPECIAL_APPROVAL_CHECK
      )
    if (specialApprovalChecks && specialApprovalChecks.length) {
      specialApprovalChecks.sort((a: any, b: any) => b._time - a._time)
      specialApprovalChecks = uniqBy(specialApprovalChecks, TYPE)

      let checks = await Promise.all(specialApprovalChecks.map(r => this.bot.getResource(r)))
      let checkOverride, checkOverridePre
      checks.forEach((check: any) => {
        let ctype = check[TYPE]
        if (ctype === SPECIAL_APPROVAL_REQUIRED_CHECK) {
          checkOverride = check.checkOverride
        } else if (ctype === PRE_SPECIAL_APPROVAL_CHECK) checkOverridePre = check.checkOverride
      })
      let bsaCode, ddr
      let { bsaList, ddrList } = this.conf

      if (checkOverridePre) {
        checkOverridePre = await this.bot.getResource(checkOverridePre)
        bsaCode = checkOverridePre.bsaCode
        ddr = checkOverridePre.ddr
      }
      if (checkOverride) {
        checkOverride = await this.bot.getResource(checkOverride)
        if (checkOverride.ddr) ddr = checkOverride.ddr
        if (checkOverride.bsaCode) bsaCode = checkOverride.bsaCode
      }
      if (ddr) {
        let ddrcoef = ddrList[ddr] || (ddrList.autohigh.includes(ddr.toUpperCase()) && 100) || 0
        summary.historicalBehaviorRisk = (weights.historicalBehaviorRisk * ddrcoef) / 100
      }
      if (bsaCode) {
        let bsacoef =
          bsaList[bsaCode] || (bsaList.autohigh.includes(bsaCode.toLowerCase()) && 100) || 0
        summary.bsaCodeRisk = (weights.bsaCodeRisk * bsacoef) / 100
      }
    }

    let legalEntity = forms && forms.find(d => d[TYPE] === LE)
    let preOnboarding = forms && forms.find(d => d[TYPE].indexOf('.PreOnboarding') !== -1)

    let { models } = this.bot

    summary.legalStructureRisk = weights.legalStructure
    if (legalEntity) this.getLegalStructureScore(legalEntity, application)
    if (summary.legalStructureRisk || !('legalStructureRisk' in summary)) {
      if (preOnboarding) this.getLegalStructureScore(preOnboarding, application)
    }
    if (!size(summary)) {
      // application.score = 100
      return
    }
    // this.calcApplicatinScore({ application })
  }
  getLegalStructureScore(payload, application) {
    let { summary, details } = application.scoreDetails
    let { weights } = this.riskFactors

    if ('legalStructureRisk' in summary && !summary.legalStructureRisk) return
    summary.legalStructureRisk = weights.legalStructure

    let { regulated, country, typeOfOwnership, tradedOnExchange } = payload
    let { models } = this.bot

    if (regulated) {
      let id = getEnumValueId({ model: models[COUNTRY], value: country })
      if (id === 'DE' || id === 'GB') {
        summary.legalStructureRisk = 0
        return
      }
    } else if (typeOfOwnership && tradedOnExchange) {
      if (
        getEnumValueId({ model: models[TYPE_OF_OWNERSHIP], value: typeOfOwnership }) ===
        'publiclyTraded'
      ) {
        let exchange = getEnumValueId({ model: models[STOCK_EXCHANGE], value: tradedOnExchange })
        if (exchange === 'NYSE' || exchange === 'NASDAQ') summary.legalStructureRisk = 0
      }
    }
  }
  calcOneCategoryScore({ name, details }) {
    if (!details || !details.length) return 0
    let scoresForTheName = details.filter(r => r[name])
    let scores = scoresForTheName.map(r => r[name].score)
    if (!scores.length) return 0
    return Math.max(...scores)
  }
  public checkCountries = ({ scoreDetails, countriesToCheck, name, category }) => {
    if (typeof countriesToCheck === 'string') countriesToCheck = [countriesToCheck]
    if (!countriesToCheck.length) {
      return
    }
    let { defaultValue, weights, countries, countriesRiskByCategory } = this.riskFactors
    let defaultC = countries.default || defaultValue
    let weight = weights.countriesOfOperation //weights.countryOfOperation / countriesOfOperation.length
    let details: any = {}
    let hasAutohigh
    countriesToCheck.forEach(c => {
      let cid = c.id.split('_')[1]
      // HACK - need to fix in app multiselect
      if (!cid.length) return

      let riskType = countries.find(c => c.code === cid)

      let risk = (riskType && riskType.risk) || 'missingInvalid'

      let coef = countriesRiskByCategory[risk][category]
      if (coef) details[cid] = this.addDetailScore({ value: (defaultC * weight) / 100, coef })
      if (risk === 'autohigh') {
        extend(details[cid], { risk: AUTOHIGH })
        hasAutohigh = true
      }
    })
    // HACK - need to fix in app multiselect
    if (!size(details)) return
    let score: number[] = Object.values(details).map((detail: any) => detail.score)
    scoreDetails[name] = {
      score: Math.max(...score),
      ...details
    }
    if (hasAutohigh) scoreDetails.risk = AUTOHIGH
  }
  public checkCountry({ country }) {
    let cid = country.id.split('_')[1]

    let { defaultValue, weights, countries, countriesRiskByCategory } = this.riskFactors

    let riskType = countries.find(c => c.code === cid)
    let risk = riskType.risk
    let coef = countriesRiskByCategory[risk]['Registration']

    if (!coef) return
    let weight = weights.countryOfRegistration
    let defaultC = countries.default || defaultValue
    let detail = this.addDetailScore({ value: (defaultC * weight) / 100, coef })
    let scoreDetail = {
      [cid]: detail,
      score: detail.score
    }
    if (risk === 'autohigh') extend(scoreDetail, { risk: AUTOHIGH })
    return scoreDetail
    // scoreDetails.countryOfRegistration = {
    //   [cid]: this.addDetailScore({ value: (defaultC * weight) / 100, coef })
    // }
    // scoreDetails.countryOfRegistration.score = scoreDetails.countryOfRegistration[cid].score
  }
  public roundScore = score => {
    return (score && Math.round(score * 100) / 100) || score
  }
  public resetBsaRiskWithOverride({ payload, application }) {
    let { summary, details } = application.scoreDetails
    let { bsaCodeRisk } = summary
    let { bsaList, ddrList } = this.conf

    let { bsaCode, ddr } = payload
    if (!bsaCode) return

    let coef = bsaList[bsaCode] || (bsaList.autohigh.find(c => c === bsaCode) && 100)

    let { weights } = this.riskFactors

    let bsaDetail = details.find(d => d.bsaCodeRisk)
    if (coef) {
      // let coef = (code === 'fe102' && 21) || 100
      summary.bsaCodeRisk = this.roundScore((weights.bsaCodeRisk * coef) / 100)
      debugger

      // bsaDetail.previousBsaScore = bsaDetail.bsaCodeRisk[code]

      if (coef === 100) bsaDetail.risk = AUTOHIGH
      bsaDetail.bsaCodeRisk[bsaCode] = summary.bsaCodeRisk
    } else {
      summary.bsaCodeRisk = 0
      bsaDetail.bsaCodeRisk[bsaCode] = summary.bsaCodeRisk
    }
    if (ddr) {
      let coef = ddrList[ddr] || ddrList.find(d => d === ddr)
      if (coef) {
        summary.historicalBehaviorRisk = weights.historicalBehaviorRisk
        bsaDetail.historicalBehaviorRisk = { [ddr]: summary.historicalBehaviorRisk }
      } else {
        summary.historicalBehaviorRisk = 0
        bsaDetail.historicalBehaviorRisk = { [ddr]: 0 }
      }
    }

    // this.calcApplicatinScore({ application })
  }
  public getAccountScore({ stubs }) {
    const weight = this.riskFactors.weights.accountTypeRisk
    const { models } = this.bot
    let accounts = stubs.filter(stub => isSubClassOf(BANK_ACCOUNT, models[stub[TYPE]], models))
    let score = this.roundScore((weight * (4 + accounts.length - 1) * 3) / 100)
    if (score > weight) score = weight
    return {
      score,
      name: 'Account Type Risk',
      numberOfAccounts: accounts.length
    }
  }
  public getBsaScore(form, application) {
    let code =
      form.bsaListPI ||
      form.bsaListDE ||
      form.bsaListFE ||
      form.bsaListMS ||
      form.bsaListRT ||
      form.bsaListNG ||
      form.bsaListOR

    if (!code) return
    const weight = this.riskFactors.weights.bsaCodeRisk
    code = code.id.split('_')[1]

    let { bsaList } = this.conf
    let coef =
      bsaList[code.toLowerCase()] || (bsaList.autohigh.includes(code.toLowerCase()) && 100) || 0

    let { summary, details } = application.scoreDetails
    summary.bsaCodeRisk = this.roundScore((weight * coef) / 100)
    let detail: any = {
      form: buildResourceStub({ resource: form, models: this.bot.models }),
      bsaCodeRisk: {
        [code]: summary.bsaCodeRisk
      }
    }
    if (coef === 100) detail.risk = AUTOHIGH
    let idx = details.findIndex(d => d.bsaCodeRisk)
    if (idx !== -1) details.splice(idx, 1, detail)
    else details.push(detail)
  }
  public calcApplicatinScore({
    application,
    isCpOnboarding
  }: {
    application: IPBApp
    isCpOnboarding?: boolean
  }) {
    let { summary, details } = application.scoreDetails
    if (!isCpOnboarding) {
      let { baseRisk } = summary
      if (!baseRisk) {
        const { baseRisk, weights, transactionalRisk } = this.riskFactors
        extend(summary, {
          baseRisk: (baseRisk.default * weights.baseRisk) / 100,
          transactionalRisk: (transactionalRisk.default * weights.transactionalRisk) / 100
        })
      }
    }
    let scores: number[] = Object.values(summary)
    let score = scores.reduce((a, b) => a + b, 0)
    application.score = this.roundScore(score)
    if (application.scoreType) application.previousScoreType = application.scoreType
    application.scoreType = this.getScoreType(application.score, this.bot.models)
    application.ruledBasedScore = 0

    let autohigh = details.filter(d => d.risk)
    if (autohigh.length) {
      application.ruledBasedScore = 100
      application.scoreType = enumValue({
        model: this.bot.models[SCORE_TYPE],
        value: 'autohigh'
      })

      return
    }
    if (isCpOnboarding) return
    if (summary.historicalBehaviorRisk) application.ruledBasedScore = summary.historicalBehaviorRisk
    else summary.historicalBehaviorRisk = 0
    if (summary.bsaCodeRisk) {
      if (summary.bsaCodeRisk > summary.historicalBehaviorRisk)
        application.ruledBasedScore = summary.historicalBehaviorRisk
    } else summary.bsaCodeRisk = 0
    if (application.ruledBasedScore === 100) {
      application.scoreType = enumValue({
        model: this.bot.models[SCORE_TYPE],
        value: 'autohigh'
      })
    }
  }
  public getScoreType = (score, models) => {
    const { low, high, medium, autohigh } = this.riskFactors
    let value
    if (score < low) value = 'low'
    else if (score < medium) value = 'medium'
    else if (score < high) value = 'high'
    else if (score < autohigh) value = 'autohigh'

    return enumValue({
      model: models[SCORE_TYPE],
      value
    })
  }
  public resetScoreFor({ name, detail, application }) {
    let { scoreDetails } = application
    if (!scoreDetails) {
      scoreDetails = { details: [], summary: {} }
      application.scoreDetails = scoreDetails
    }
    let { details, summary } = scoreDetails
    // scoreDetails = scoreDetails.scoreDetails || scoreDetails.result
    let idx = details && details.findIndex(r => r.name === detail.name)
    if (idx !== -1) details.splice(idx, 1, detail)
    else details.push(detail)

    summary.accountTypeRisk = detail.score
    // this.calcApplicatinScore({ application })
  }

  public addDetailScore = ({ value, coef }) => {
    return { /*value, coef,*/ score: Math.round(value * coef) / 100 }
  }
  // public getDdrScore = ({ payload }) => {
  //   let { ddr } = payload
  //   if (!ddr) return
  //   ddr = ddr.replace(/\s/g, '')
  //   if (!ddr.length) return
  //   // historical behavior
  //   const { historicalBehaviorRisk } = riskFactors.weights
  //   return {
  //     score: (historicalBehaviorRisk * riskFactors.defaultValue) / 100,
  //     historicalBehaviorRisk: true,
  //     name: 'Historical Behavior Risk'
  //   }
  // }
}

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const rsApi = new RiskScoreAPI({
    bot,
    conf,
    logger,
    applications
  })

  const plugin = {
    async onmessage(req) {
      const { application, payload } = req
      if (!application) return

      let { riskFactors, products, propertyMap, bsaList, ddrList } = conf
      if (!riskFactors || !products) return

      const { models } = bot

      let ptype = payload[TYPE]

      if (
        ptype === SPECIAL_APPROVAL_REQUIRED_CHECK_OVERRIDE ||
        ptype === PRE_SPECIAL_APPROVAL_CHECK_OVERRIDE
      ) {
        rsApi.resetBsaRiskWithOverride({ payload, application })
        rsApi.calcApplicatinScore({ application })

        return
      }

      let { requestFor } = application

      let forms = products[requestFor]
      if (!forms || !forms.includes(ptype)) return

      let stubs = getFormStubs({ forms: application.forms }).reverse()
      stubs = uniqBy(stubs, '_permalink')

      stubs = stubs.filter(
        stub => forms.includes(stub[TYPE]) && stub._permalink !== payload._permalink
      )

      let scoreDetails
      let isAccount = isSubClassOf(BANK_ACCOUNT, models[payload[TYPE]], models)
      if (isAccount) {
        stubs = stubs.slice()
        stubs.push(buildResourceStub({ resource: payload, models }))
        let accountScore: any = rsApi.getAccountScore({ stubs })

        rsApi.resetScoreFor({ name: 'accountTypeRisk', detail: accountScore, application })
        rsApi.calcApplicatinScore({ application })
        return
      }
      let hasScoreChanged
      if (ptype.indexOf('PreOnboarding') !== -1) {
        if (!application.scoreDetails)
          application.scoreDetails = {
            details: [],
            summary: {}
          }

        rsApi.getBsaScore(payload, application)
        rsApi.getLegalStructureScore(payload, application)
        hasScoreChanged = true
        // rsApi.calcApplicatinScore({ application })

        // return
      }
      let scoreForms
      // debugger
      if (stubs.length) scoreForms = await Promise.all(stubs.map(stub => bot.getResource(stub)))
      else scoreForms = []
      scoreForms.push(payload)

      scoreDetails = await Promise.all(
        scoreForms.map(form => {
          let map = propertyMap[form[TYPE]]
          if (map) map = { ...defaultMap, ...map }
          else map = defaultMap
          return rsApi.getScore({ form, req, map, requestFor })
        })
      )
      let isCpOnboarding = requestFor === CP_ONBOARDING
      scoreDetails = scoreDetails.filter(r => r)
      if (!scoreDetails.length) {
        if (hasScoreChanged) rsApi.calcApplicatinScore({ application, isCpOnboarding })
        return
      }

      // scoreDetails = scoreDetails.filter(r => size(r) > 1)
      let oldScoreDetails = application.scoreDetails
      if (oldScoreDetails && oldScoreDetails.details.length) {
        let notChanged = oldScoreDetails.details.filter(r => {
          let { form, name } = r
          if (form) {
            if (r.bsaCodeRisk || r.accountTypeRisk) return true
            return scoreDetails.findIndex(rr => rr.form._permalink === form._permalink) === -1
          } else {
            return scoreDetails.findIndex(rr => rr.name === name) === -1
          }
        })
        scoreDetails = scoreDetails.concat(notChanged)
      }
      application.scoreDetails = {
        details: scoreDetails,
        summary: (application.scoreDetails && application.scoreDetails.summary) || {}
      }
      if (isCpOnboarding) {
        let { details } = application.scoreDetails
        let countriesDetails = details.filter(d => d.countryOfResidence || d.countriesOfCitizenship)
        let scores = countriesDetails.map(
          d =>
            (d.countryOfResidence && d.countryOfResidence.score) ||
            (d.countriesOfCitizenship && d.countriesOfCitizenship.score)
        )
        let score = Math.max(...scores)
        application.scoreDetails.summary = {
          beneficialOwnerRisk: score
        }
      } else await rsApi.calcScore({ application, forms: scoreForms })
      rsApi.calcApplicatinScore({ application, isCpOnboarding })
      // HACK
      application.scoreDetails.details = application.scoreDetails.details.filter(r => size(r) > 1)
      // debugger
    },
    // resetScore({ name, detail, application }) {
    //   let { scoreDetails } = application
    //   if (!scoreDetails) {
    //     scoreDetails = { details: [], summary: {} }
    //     application.scoreDetails = scoreDetails
    //   }
    //   let { details, summary } = scoreDetails
    //   // scoreDetails = scoreDetails.scoreDetails || scoreDetails.result
    //   let idx = details && details.findIndex(r => r.name === detail.name)
    //   if (idx !== -1) details.splice(idx, 1, detail)
    //   else details.push(detail)

    //   summary.accountTypeRisk = detail.score
    //   rsApi.calcApplicatinScore(application)
    // },
    onFormsCollected: async ({ req }) => {
      // debugger
      let { riskFactors, products } = conf
      if (!riskFactors || !products) return

      const { user, application, payload } = req
      if (!application) return
      let { requestFor } = application
      let formType = products[requestFor]
      if (!formType) return
      let ptype = payload[TYPE]

      if (typeof formType === 'string') {
        if (ptype !== formType) return
      } else if (!formType[ptype]) return
      let { defaultValue } = riskFactors
      await checkParent({ application, defaultValue, bot, applications })
    }
  }
  return { plugin }
}
async function checkParent({ application, defaultValue, bot, applications }) {
  let { ruledBasedScore } = application
  if (ruledBasedScore === defaultValue || !application.parent) return
  let parentApp = await bot.getResource({
    [TYPE]: application[TYPE],
    _permalink: application.parent._permalink
  })
  let parentRuledBasedScore = parentApp.ruledBasedScore
  if (parentRuledBasedScore && parentRuledBasedScore < ruledBasedScore) return
  parentApp.ruledBasedScore = ruledBasedScore
  await applications.updateApplication(parentApp)
  if (parentApp.parent)
    await checkParent({ application: parentApp, defaultValue, bot, applications })
}
