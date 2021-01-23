import constants from '@tradle/constants'
import {
  Bot,
  Logger,
  //   IPBApp,
  IPBReq,
  //   ITradleObject,
  CreatePlugin,
  Applications,
  ValidatePluginConf
} from '../types'
import { extend } from 'lodash'

const { TYPE } = constants
import {
  getStatusMessageForCheck,
} from '../utils'
const COMPANY_FINANCIALS = 'tradle.CompanyFinancials'
const COMPANY_FINANCIALS_CHECK = 'tradle.CompanyFinancialsCheck'
const ALTMAN_SCORES = 'tradle.AltmanScores'
const Z_SCORES = 'tradle.AltmanBPD'
const PROVIDER = 'Tradle'
class CreditRiskAPI {
  private bot: Bot
  private conf: any
  private logger: Logger
  private applications: Applications
  constructor({ bot, conf, applications, logger }) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
    this.logger = logger
  }
  public async calculate({ req }) {
    const { application, payload } = req
    const {
      cash,
      cashEquivalents=0,
      capitalExpenditure,
      currentEarnings,
      currentLiabilities,
      inventory,
      investments,
      incomeTax,
      interest,
      accountsReceivable,
      // amortization,
      longTermLiabilities,
      shareholderEquity,
      depreciation,
      retainedEarnings,
      revenue
    } = payload
    debugger
    if (!cash ||
        // !cashEquivalents ||
        !capitalExpenditure ||
        !currentEarnings ||
        !currentLiabilities ||
        !inventory ||
        !investments ||
        // !incomeTax ||
        !interest ||
        !accountsReceivable ||
        // amortization ||
        !longTermLiabilities ||
        !shareholderEquity ||
        !depreciation ||
        // !revenue ||
        !retainedEarnings) {
      await this.createCheck({
        resultDetails: 'Insufficient data to perform calculations'
      }, req)
      return
    }
    let altman = this.bot.models[this.conf.altmanScoresModel]
    if (!altman) {
      await this.createCheck({
        resultDetails: 'The model for Altman Z Score is either incorrect or absent'
      }, req)
      return
    }
    const {
      factor=0,
    } = this.conf
    let ratings = this.bot.models[ALTMAN_SCORES]
    if (!ratings) {
      await this.createCheck({
        resultDetails: 'Insufficient data to perform calculations'
      }, req)
      return
    }
    const currency = cash.currency
    let fc:any = {
      [TYPE]: COMPANY_FINANCIALS_CHECK,
      currentAssets: {
        value: cash.value + (cashEquivalents  &&  cashEquivalents.value || 0) + accountsReceivable.value + inventory.value + investments.value,
        currency
      },
      assets: {
        value: currentLiabilities.value + longTermLiabilities.value + shareholderEquity.value,
        currency
      },
      liabilities: {
        value: currentLiabilities.value + longTermLiabilities.value,
        currency
      },
      ebit: {
        value: currentEarnings.value + (incomeTax  && incomeTax.value || 0) + interest.value,
        currency
      },
    }

    let e = altman.enum.find(e => e.id === 'X1')
    let AltmanZX1 = e.value
    e = altman.enum.find(e => e.id === 'X2');
    let AltmanZX2 = e.value
    e = altman.enum.find(e => e.id === 'X3');
    let AltmanZX3 = e.value
    e = altman.enum.find(e => e.id === 'X4');
    let AltmanZX4 = e.value
    e = altman.enum.find(e => e.id === 'X5');
    let AltmanZX5 = e  &&  e.value || 0

    extend(fc, {
      ebitda: {
        value: fc.ebit.value + depreciation.value,
        currency
      },
      acidTest: (fc.currentAssets.value - inventory.value) / currentLiabilities.value,
      liquidityIndex: fc.currentAssets.value / currentLiabilities.value,
      workingCapital: {
        value: fc.currentAssets.value - currentLiabilities.value,
        currency
      },
    })
    extend(fc, {
      prawc: fc.workingCapital.value / fc.ebitda.value,
      freeCashFlow: {
        value: fc.ebitda.value - capitalExpenditure.value,
        currency
      },
      x1: Math.round((fc.workingCapital.value / fc.assets.value) * AltmanZX1 * 100)/100,
      x2: Math.round((retainedEarnings.value / fc.assets.value) * AltmanZX2 * 100)/100,
      x3: Math.round((fc.ebit.value / fc.assets.value) * AltmanZX3 * 100)/100,
      x4: Math.round((shareholderEquity.value / fc.liabilities.value) * AltmanZX4 * 100)/100,
      x5: Math.round((revenue  && (revenue.value / fc.assets.value) * AltmanZX5) * 100)/100 || 0
    })
    extend(fc, {
      zScore: fc.x1 + fc.x2 + fc.x3 + fc.x4 + fc.x5 + factor
    })
    ratings.enum.sort((a, b) => a.zScore > b.zScore)
    let rating = ratings.enum.find(r => r.zScore > fc.zScore)
    if (!rating)
      rating = ratings.enum[ratings.enum.length - 1]
    extend(fc, {
      zScoreRating: rating.zScore,
      pd: rating.pd
    })
    await this.createCheck(fc, req)
  }
  async createCheck(check, req) {
    const { payload, application } = req
    let status
    let zScores = this.bot.models[Z_SCORES]
    let low = zScores.enum.find(e => e.id === 'low')
    let high = zScores.enum.find(e => e.id === 'high')

    if (check.resultDetails)
      status = 'error'
    else if (check.zScore > low.pd)  {
      check.resultDetails = low.title
      status = 'pass'
    }
    else if (check.zScore > high.pd) {
      check.resultDetails =	'Insolvency can not be predicted'
      status = 'pass'
    }
    else {
      check.resultDetails =	high.title
      status = 'fail'
    }

    extend (check, {
      [TYPE]: COMPANY_FINANCIALS_CHECK,
      form: payload,
      provider: PROVIDER,
      application,
      dateChecked: Date.now(),
      aspects: 'Credit Risk',
      status
    })
    check.message = getStatusMessageForCheck({ models: this.bot.models, check })

    let checkR = await this.applications.createCheck(check, req)

    // debugger
    return checkR.toJSON()
  }
}
export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const creditRisk = new CreditRiskAPI({ bot, conf, applications, logger })
  const plugin = {
    async onmessage(req: IPBReq) {
      const { application, payload } = req
      if (!application) return
      if (payload[TYPE] !== COMPANY_FINANCIALS)
        return
      await creditRisk.calculate({ req })
    }
  }

  return {
    plugin
  }
}
export const validateConf: ValidatePluginConf = async ({ bot, pluginConf }) => {
  const { models } = bot
  debugger
  const { altmanScoresModel } = pluginConf
  if (!altmanScoresModel)
    throw new Error(`missing 'altmanScoresModel' property`)
  if (!models[altmanScoresModel])
    throw new Error(`missing model: ${altmanScoresModel}`)
}
