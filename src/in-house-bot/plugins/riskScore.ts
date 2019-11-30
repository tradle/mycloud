/***
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
import _ from 'lodash'
// import validateResource from '@tradle/validate-resource'
import { TYPE } from '@tradle/constants'
import {
  Bot,
  CreatePlugin,
  IWillJudgeAppArg,
  IPBReq,
  IPluginLifecycleMethods,
  ValidatePluginConf,
  ITradleObject,
  IPBApp,
  Applications,
  Logger
} from '../types'
import { getEnumValueId } from '../utils'
const riskFactors = require('../../../riskFactors.json')
const CP_ONBOARDING = 'tradle.legal.ControllingPersonOnboarding'
const CE_ONBOARDING = 'tradle.legal.LegalEntityProduct'
const CORPORATION_EXISTS = 'tradle.CorporationExistsCheck'
const BENEFICIAL_OWNER_CHECK = 'tradle.BeneficialOwnerCheck'
const PHOTO_ID = 'tradle.PhotoID'
const STATUS = 'tradle.Status'

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const plugin = {
    async onmessage(req) {
      const { user, application, payload } = req
      if (!application) return
      let { requestFor } = application
      let formType = conf.products[requestFor]
      if (!formType) return
      let ptype = payload[TYPE]

      if (typeof formType === 'string') {
        if (ptype !== formType) return
      } else if (!formType[ptype]) return

      let { defaultValue, weights, countries, legalStructure, historicalBehaviorRisk } = riskFactors

      if (!application.scoreDetails) application.scoreDetails = {}
      let { scoreDetails } = application

      let { country, countriesOfOperation } = payload
      if (country) {
        let cid = country.id.split('_')[1]
        let coef = countries[cid]
        if (coef) {
          let weight = weights.countryOfRegistration
          let defaultC = countries.default || defaultValue
          scoreDetails.countryOfRegistration = {
            [cid]: addDetailScore({ value: (defaultC * weight) / 100, coef })
          }
          scoreDetails.countryOfRegistration.score = scoreDetails.countryOfRegistration[cid].score
          if (requestFor === CP_ONBOARDING) {
            application.score = getScore(scoreDetails, riskFactors)
            await this.checkParent(application, defaultValue)
            return
          }
        }
      }
      if (countriesOfOperation) {
        checkCountriesOfOperation({ scoreDetails, countriesOfOperation, riskFactors })
      }
      let { latestChecks } = req
      let checks = latestChecks || application.checks
      checks = checks.filter(
        check => check[TYPE] === CORPORATION_EXISTS || check[TYPE] === BENEFICIAL_OWNER_CHECK
      )
      if (!checks) {
        application.score = getScore(scoreDetails, riskFactors)
        await this.checkParent(application, defaultValue)
        return
      }
      let sanctionsChecks
      if (!latestChecks) {
        checks = await Promise.all(checks.map(check => bot.getResource(check)))
        checks.sort((a, b) => b._time - a._time)
        sanctionsChecks = checks.filter(check => check[TYPE] === 'tradle.SanctionsCheck')
        sanctionsChecks.sort((a, b) => b.time - a.time)
        sanctionsChecks = _.uniqBy(sanctionsChecks, 'propertyName')
      } else {
        sanctionsChecks = latestChecks.filter(check => check[TYPE] === 'tradle.SanctionsCheck')
      }
      const models = bot.models
      if (sanctionsChecks) {
        let failedCheck = sanctionsChecks.find(
          check => getEnumValueId({ model: bot.models[STATUS], value: check.status }) !== 'pass'
        )
        if (failedCheck) {
          let defaultH = historicalBehaviorRisk.default || defaultValue
          let value = (defaultH * weights.historicalBehaviorRisk) / 100
          scoreDetails.historicalBehaviorRisk = addDetailScore({ value, coef: 1 })
        }
      }
      checks = _.uniqBy(checks, TYPE)
      let corpExistsCheck = checks.find(
        check =>
          check[TYPE] === CORPORATION_EXISTS &&
          getEnumValueId({ model: models[STATUS], value: check.status }) === 'pass'
      )
      if (corpExistsCheck) checkOfficers({ scoreDetails, corpExistsCheck, riskFactors })

      let beneRiskCheck = checks.find(
        check =>
          check[TYPE] === BENEFICIAL_OWNER_CHECK &&
          getEnumValueId({ model: models[STATUS], value: check.status }) === 'pass'
      )
      if (!beneRiskCheck || !beneRiskCheck.rawData || !beneRiskCheck.rawData.length) {
        let score = getScore(scoreDetails, riskFactors)
        application.score = Math.round(score)
        await this.checkParent(application, defaultValue)
        return
      }
      let { rawData } = beneRiskCheck
      let boScore = {}
      rawData.forEach(elm => {
        let { data } = elm
        if (!data) return
        let { kind, identification, address, natures_of_control, ceased_on } = data
        if (ceased_on) return
        if (natures_of_control && !natures_of_control.length) {
          // no control
          return
        }
        let isIndividual = kind.startsWith('individual-')
        if (isIndividual) {
        } else {
          let legalForm = identification && identification.legal_form
          if (legalForm) {
            let coef = legalStructure[legalForm.toLowerCase().replace(/\s/g, '_')]
            if (coef) {
              let defaultL = legalStructure.default || defaultValue
              let value = (defaultL * weights.legalStructure) / 100
              boScore[legalForm] = addDetailScore({ value, coef })
            }
          }
        }
      })

      if (_.size(boScore)) scoreDetails.boScore = boScore
      application.score = getScore(scoreDetails, riskFactors)
      await this.checkParent(application, defaultValue)
    },
    async checkParent(application, defaultValue) {
      let { score } = application
      if (score === defaultValue || !application.parent) return
      let parentApp = await bot.getResource(application.parent)
      let pscore = parentApp.score
      if (pscore && pscore < score) return
      parentApp.score = score
      await applications.updateApplication(parentApp)
      if (parentApp.parent) await this.checkParent(parentApp, defaultValue)
    }
  }
  return { plugin }
}
function addDetailScore({ value, coef }) {
  return { value, coef, score: Math.round(value * coef * 100) / 100 }
}
function getScore(scoreDetails, riskFactors) {
  const { baseRisk, weights, transactionalRisk } = riskFactors
  let score = 0
  scoreDetails.baseRisk = (baseRisk.default * weights.baseRisk) / 100
  scoreDetails.transactionalRisk = (transactionalRisk.default * weights.transactionalRisk) / 100
  score = calcScore(scoreDetails, score)
  return roundScore(score)
}

function calcScore(scoreDetails, score) {
  for (let p in scoreDetails) {
    if (scoreDetails[p].score) score += scoreDetails[p].score
    else if (typeof scoreDetails[p] === 'number') score += scoreDetails[p]
    else score = calcScore(scoreDetails[p], score)
  }
  return score
}
function checkCountriesOfOperation({ scoreDetails, countriesOfOperation, riskFactors }) {
  if (!countriesOfOperation.length) {
    return
  }
  let { defaultValue, weights, countries } = riskFactors
  let defaultC = countries.default || defaultValue
  let weight = weights.countryOfOperation / countriesOfOperation.length
  let score: any = {}
  countriesOfOperation.forEach(c => {
    let cid = c.id.split('_')[1]
    let coef = countries[cid]

    if (coef) score[cid] = addDetailScore({ value: (defaultC * weight) / 100, coef })
  })
  if (_.size(score)) {
    scoreDetails.countriesOfOperation = score
    let totalScore = 0
    for (let p in score) totalScore += score[p].score
    scoreDetails.countriesOfOperation.score = totalScore
  }
}
function checkOfficers({ scoreDetails, corpExistsCheck, riskFactors }) {
  let { industry_codes, officers } = corpExistsCheck.rawData[0].company

  let { defaultValue, weights, industries, lengthOfRelationship } = riskFactors
  let defaultO = lengthOfRelationship.default || defaultValue

  let score: any = {}
  if (industry_codes && industry_codes.length) {
    let ic = industry_codes.filter(
      code =>
        code.industry_code.code_scheme_id.startsWith('isic_') &&
        industries[code.industry_code.code + '']
    )
    if (ic.length) {
      let weight = weights.industry
      let industryCoef = 0
      ic.forEach((item: any) => {
        let coef = industries[item.industry_code.code + '']
        if (coef && coef > industryCoef) industryCoef = coef
      })
      score = addDetailScore({ value: (defaultO * weight) / 100, coef: industryCoef })
    }
  }
  if (score.value) scoreDetails.industries = score
  if (!officers || !officers.length) return
  if (officers.length)
    officers = officers.filter(o => o.officer.position !== 'agent' && !o.officer.inactive)
  if (!officers.length) return
  let weight = weights.lengthOfRelationship
  let part = defaultO / officers.length
  // let newScore = score + score * weight
  let newScore = {}
  officers.forEach(o => {
    let startDate = o.officer.start_date
    if (!startDate) return
    let endDate = o.officer.end_date
    if (endDate) endDate = new Date().getTime()
    else endDate = Date.now()
    let delta = endDate - new Date(startDate).getTime()
    let day = 1000 * 60 * 60 * 24
    let years = Math.round(delta / day / 365)
    if (years < 1) years = 1
    let coef = lengthOfRelationship[years + '']
    if (coef) newScore[o.officer.name] = addDetailScore({ value: part / 100, coef })
  })
  if (_.size(newScore)) {
    scoreDetails.lengthOfRelationship = newScore
    let totalScore = 0
    for (let p in newScore) totalScore += newScore[p].score
    scoreDetails.lengthOfRelationship.score = totalScore
  }
}
function roundScore(score) {
  return (score && Math.round(score * 100) / 100) || score
}
