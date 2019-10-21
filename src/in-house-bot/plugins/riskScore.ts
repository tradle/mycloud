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

const riskFactors = require('../../../riskFactors.json')
const CP_ONBOARDING = 'tradle.legal.ControllingPersonOnboarding'
const CE_ONBOARDING = 'tradle.legal.LegalEntityProduct'
const CORPORATION_EXISTS = 'tradle.CorporationExistsCheck'
const BENEFICIAL_OWNER_CHECK = 'tradle.BeneficialOwnerCheck'
const INITIAL_SCORE = 1000
const PHOTO_ID = 'tradle.PhotoID'
const LEGAL_ENTITY = 'tradle.legal.LegalEntity'

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const plugin = {
    async onmessage(req) {
      const { user, application, payload } = req
      if (!application) return
      let { requestFor } = application
      let formType = conf.products[requestFor]
      if (!formType || payload[TYPE] !== formType) return

      let { weights, countries, legalStructure, industries, lengthOfRelationship } = riskFactors
      let coef = countries[payload.country.id.split('_')[1]]
      let initialValue = INITIAL_SCORE
      let score = initialValue

      if (coef) {
        let weight = weights.countries
        score -= initialValue * weight * coef
        if (requestFor === CP_ONBOARDING) {
          application.score = Math.round(score)
          await this.checkParent(application)
          return
        }
      }
      let { latestChecks } = req
      let checks = latestChecks || application.checks
      checks = checks.filter(
        check => check[TYPE] === CORPORATION_EXISTS || check[TYPE] === BENEFICIAL_OWNER_CHECK
      )
      if (!checks) {
        application.score = Math.round(score)
        await this.checkParent(application)
        return
      }
      if (!latestChecks) {
        checks = await Promise.all(checks.map(check => bot.getResource(check)))
        checks.sort((a, b) => b._time - a._time)
      }
      checks = _.uniqBy(checks, TYPE)
      let corpExistsCheck = checks.find(
        check => check[TYPE] === CORPORATION_EXISTS && check.status.id.endsWith('_pass')
      )
      if (corpExistsCheck) score = checkOfficers({ score, corpExistsCheck })

      let beneRiskCheck = checks.find(
        check => check[TYPE] === BENEFICIAL_OWNER_CHECK && check.status.id.endsWith('_pass')
      )
      if (!beneRiskCheck || !beneRiskCheck.rawData || !beneRiskCheck.rawData.length) {
        application.score = Math.round(score)
        await this.checkParent(application)
        return
      }
      let { rawData } = beneRiskCheck
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
              score -= initialValue * weights.legalStructure * coef
            }
          }
        }
      })
      application.score = Math.round(score)
      await this.checkParent(application)
    },
    async checkParent(application) {
      let { score } = application
      if (score === INITIAL_SCORE || !application.parent) return
      let parentApp = await bot.getResource(application.parent)
      let pscore = parentApp.score
      if (pscore && pscore < score) return
      parentApp.score = score
      await applications.updateApplication(parentApp)
      if (parentApp.parent) await this.checkParent(parentApp)
    }
  }
  return { plugin }
}

function checkOfficers({ score, corpExistsCheck }) {
  let { industry_codes, officers } = corpExistsCheck.rawData[0].company

  let { weights, industries, lengthOfRelationship } = riskFactors

  let initialValue = INITIAL_SCORE
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
      score -= initialValue * weight * industryCoef
    }
  }
  if (officers && officers.length) {
    if (officers.length)
      officers = officers.filter(o => o.officer.position !== 'agent' && !o.officer.inactive)
    if (!officers.length) return score
    let weight = weights.lengthOfRelationship
    let part = (score * weight) / officers.length
    let newScore = score - score * weight
    officers.forEach(o => {
      let startDate = o.officer.start_date
      if (!startDate) newScore += part
      else {
        let endDate = o.officer.end_date
        if (endDate) endDate = new Date().getTime()
        else endDate = Date.now()
        let delta = endDate - new Date(startDate).getTime()
        let day = 1000 * 60 * 60 * 24
        let years = Math.round(delta / day / 365)
        if (years < 1) years = 1
        let coef = lengthOfRelationship[years + '']
        if (coef) newScore += part * coef
        else newScore += part
      }
    })
    score = newScore
  }
  return score
}
