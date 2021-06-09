import _ from 'lodash'
import { TYPE } from '@tradle/constants'
import {
  Bot,
  CreatePlugin,
  IPBReq,
  IPluginLifecycleMethods,
  ValidatePluginConf,
  ITradleObject,
  Applications,
  Logger
} from '../types'
import { buildResourceStub } from '@tradle/build-resource'

import { getEnumValueId } from '../../utils'
import { getLatestCheck, isPassedCheck } from '../utils'
import validateResource from '@tradle/validate-resource'

const CASH_FLOW = 'PersonalCashflow'
const QUOTATION_INFORMATION = 'QuotationInformation'
const QUOTATION_DETAILS = 'QuotationDetails'
const APPLICANT_INFORMATION = 'ApplicantInformation'
const APPLICANT_ADDRESS = 'ApplicantAddress'
const APPLICANT_MED_PROFESSION = 'ApplicantMedicalProfession'

const CREDIT_REPORT_CHECK = 'tradle.CreditReportIndividualCheck'
const CREDS_CHECK = 'tradle.CredentialsCheck'
const CREDS_CHECK_OVERRIDE = 'tradle.CredentialsCheckOverride'

const PRODUCT_REQUEST = 'tradle.ProductRequest'
const APPLICATION = 'tradle.Application'

// const REPORT_PROPS = {
//   CreditBureauIndividualCreditScore: ['scoreValue'],
//   ApplicantInformation: [ ['existingCustomerRating', 'score']] ,
//   CredentialsCheck: ['status'],
//   ApplicantMedicalProfession: [
//     ['yearsAtWork', 'score']
//   ],
//   ApplicantAddress: [
//     ['timeAtResidence', 'score']
//   ],
//   CreditBureauIndividualAccounts: ['totalMop2', 'totalMop3', 'totalMop4', 'totalMop5', 'accountClosingDate'],
//   PersonalCashflow: ['debtFactor'],
//   QuotationInformation: [
//     ['asset', 'usefulLife', 'years'],
//     ['secondaryMarket', 'score'],
//     ['relocationTime', 'score'],
//     ['assetType', 'score'],
//     ['leaseType', 'score'],
//   ]
// }
type ScoringReportOpts = {
  bot: Bot
  conf: any
  applications: Applications
  logger: Logger
}
export class ScoringReport {
  private bot: Bot
  private conf: any
  private applications: Applications
  private logger: Logger
  constructor({ bot, conf, applications, logger }: ScoringReportOpts) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
    this.logger = logger
  }
  public async exec({ reportForms, resultForm, items, check, application }) {
    let map = {}
    reportForms.forEach(f => {
      map[f[TYPE].split('.').slice(-1)[0]] = f
    })
    let { creditReport } = check
    if (!creditReport) return

    creditReport = await this.bot.getResource(creditReport, {backlinks: ['accounts', 'creditScore' ]})
    // let creditBureauScore = 0
    // if (creditReport.creditScore  &&  creditReport.creditScore.length) {
    //   let cbScore = await this.bot.getResource(creditReport.creditScore[0])
    //   cbScore = cbScore.scoreValue

    //   const cbScoreForApplicant = this.conf.creditBuroScoreForApplicant
    //   creditBureauScore = this.calcScore(cbScore, cbScoreForApplicant)
    // }
    const applicantInformation = map[APPLICANT_INFORMATION]

    let val = this.getEnumValue(applicantInformation, 'existingCustomerRating')
    let existingCustomer = val &&  val.score || 0

    let yearsAtWork = 0
    const applicantMedicalProfession = map[APPLICANT_MED_PROFESSION]
    if (applicantMedicalProfession) {
      if (applicantMedicalProfession.yearsAtWork) {
        val = this.getEnumValue(applicantMedicalProfession, 'yearsAtWork')
        yearsAtWork = val.score
      }
    }
    const applicantAddress = map[APPLICANT_ADDRESS]
    let yearsAtResidence = 0
    if (applicantAddress.yearsAtResidence) {
      val = this.getEnumValue(applicantAddress, 'yearsAtResidence')
      yearsAtResidence = val.score
    }
    const capacityToPayConf = this.conf.capacityToPay
    const debtFactor = map[CASH_FLOW] && map[CASH_FLOW].debtFactor
    const capacityToPay = debtFactor && this.calcScore(debtFactor, capacityToPayConf) || 0

    let { creditBureauScore, accountsPoints } = await this.scoreFromCheck({ item: application, creditReport, check })

    let specialityCouncil = 0
    if (await this.credencialsCheckPass(application))
      specialityCouncil = 3

    let cosignerCreditBureauScore = 0
    // if (items  &&  items.length) {
    //   items = await Promise.all(items.map(item => this.bot.getResource(item, {backlinks: ['checks']})))
    //   // for (let i=0; i<items.length; i++) {
    //   let cosignerScores = await this.scoreFromCheck({ item: items[0], isEndorser: true})
    //   cosignerCreditBureauScore = cosignerScores.creditBureauScore
    // }
    let qi = map[QUOTATION_INFORMATION]
    let qd = map[QUOTATION_DETAILS]
    let usefulLife = 0, secondaryMarket = 0, relocation = 0, assetType = 0, leaseType = 0
    if (qi && qi.asset) {
      const asset = await this.bot.getResource(qi.asset)
      // const { usefulLife, secondaryMarket, relocationTime, assetType, leaseType } = asset

      let val = this.getEnumValue(asset, 'usefulLife')
      if (val) {
        // let term = this.getEnumValue(qd, 'term', qd.term)
        let term = parseInt(qd.term.title.split(' ')[0]) / 12
        if (val.years > term)
          usefulLife = 7
        else if (val.years === term)
          usefulLife = 5
        else
          usefulLife = 0
      }

      val = this.getEnumValue(asset, 'secondaryMarket')
      if (val) secondaryMarket = val.score

      val = this.getEnumValue(asset, 'relocationTime')
      if (val) relocation = val.score

      val = this.getEnumValue(asset, 'assetType')
      if (val) assetType = val.score

      val = this.getEnumValue(asset, 'leaseType')
      if (val) leaseType = val.score
    }
    const characterScore = creditBureauScore + existingCustomer + yearsAtWork + yearsAtResidence
    const paymentScore = capacityToPay
    const assetScore = usefulLife + secondaryMarket + relocation + assetType + leaseType
    let props = {
      creditBureauScore,
      existingCustomer,
      specialityCouncil,
      yearsAtWork,
      yearsAtResidence,
      capacityToPay,
      usefulLife,
      secondaryMarket,
      relocation,
      assetType,
      leaseType,
      cosignerCreditBureauScore,
      accounts: accountsPoints,
      totalScore: characterScore + paymentScore + assetScore,
      // check
    }
    return await this.bot.draft({ type: resultForm }).set(props).signAndSave()
  }
  private async credencialsCheckPass(application) {
    const { checks, checkOverrides } = application
    const { models } = this.bot
    let credsChecks = checks.find(check => check[TYPE] === CREDS_CHECK)
    let credsCheckPass
    if (!credsChecks || !credsChecks.length)
      return
    let cChecks:any = await Promise.all(credsChecks.map(c => this.bot.getResource(c)))
    cChecks.sort((a, b) => b._time - a._time)
    let credsCheck = await this.bot.getResource(credsChecks[0])
    if (!checkOverrides) {
      if (isPassedCheck({status: credsCheck.status})) return true
      return false
    }
    let credsCheckOverride = cChecks.find(co => co[TYPE] === CREDS_CHECK_OVERRIDE)
    if (credsCheckOverride) {
      if (isPassedCheck({status: credsCheckOverride.status})) return true
      else return false
    }
    if (isPassedCheck({status: credsCheck.status})) return true
    else return false
  }
  private getEnumValue(resource, prop) {
    const evalue = resource[prop]
    if (!evalue) return
    const { models } = this.bot
    const m = models[resource[TYPE]]
    let pm = models[m.properties[prop].ref]
    let eValueId = getEnumValueId({
      model: pm,
      value: evalue
    })
    return pm.enum.find(e => e.id === eValueId)
  }
  private async scoreFromCheck({item, isEndorser, check, creditReport}:{item:any, isEndorser?: boolean, check?:any, creditReport?:any}) {
    const { creditBuroScoreForEndorser, creditBuroScoreForApplicant } = this.conf
    const cbScoreMap = isEndorser ? creditBuroScoreForEndorser : creditBuroScoreForApplicant
    if (item.status !== 'approved'  &&  item.status !== 'completed') return
    if (!check) {
      const { checks } = item
      let cChecks:any = checks.filter(check => check[TYPE] === CREDIT_REPORT_CHECK)
      if (!cChecks) return

      cChecks = await Promise.all(cChecks.map(c => this.bot.getResource(c)))
      cChecks.sort((a, b) => b._time - a._time)
      check = cChecks[0]
      creditReport = check.creditReport  &&  await this.bot.getResource(check.creditReport)
      if (!creditReport) return
    }

    let creditBureauScore = 0
    if (creditReport.creditScore && creditReport.creditScore.length) {
      let crCreditScore:any = await this.bot.getResource(creditReport.creditScore[0])

      let ecbScore = crCreditScore.scoreValue
      creditBureauScore = await this.calcScore(ecbScore, cbScoreMap)
    }
    if (isEndorser)
      return { creditBureauScore }
    let crAccounts = creditReport.accounts
    if (!crAccounts  ||  !crAccounts.length) return
    let accountsPoints =  await this.calcAccounts(crAccounts)

    return { creditBureauScore, accountsPoints }
  }
  private async calcAccounts(crAccounts) {
    let accounts:any = await Promise.all(crAccounts.map(a => this.bot.getResource(a)))
    let accountInfo = []
    let sumProps = ['totalMop2', 'totalMop3', 'totalMop4', 'totalMop5']
    let data = accounts.map(acc => {
      let sum = 0
      sumProps.forEach((p, i) => {
        let v = acc[sumProps[i]]
        if (!v)
          v = 0
        else  if (typeof v === 'string') {
          try {
            v = parseInt(v)
          } catch (err) {
            this.logger.debug('Not a number', err)
            return
          }
        }
        sum += v
      })
      return {accountClosingDate: acc.accountClosingDate, sum }
    })
    let close = 0, open = 0
    let goodOpen = 0, goodClose = 0, avgOpen = 0, avgClose = 0, badOpen = 0, badClose = 0
    accounts.forEach(account => {
      const {accountClosingDate, sum} = account
      if (accountClosingDate) {
        open++
        if (sum < 4) goodClose++
        else if (sum === 4) avgClose++
        else badClose++
      }
      if (!accountClosingDate) {
        close++
        if (sum < 4) goodOpen++
        else if (sum === 4) avgOpen++
        else badOpen++
      }
    })
    // high=16, average=8, low=4
    const { accountsScore } = this.conf
    const { high, average, low } = accountsScore
    if (open && close) {
      let points = 0
      let hcoef = high / (open + close)
      let acoef = average / (open + close)

      if (goodOpen)
        points += hcoef * goodOpen
      if (goodClose)
        points += hcoef * goodClose
      if (avgOpen)
        points += acoef * avgOpen
      if (avgClose)
        points += acoef * avgClose

      return Math.round(points)
    }
    if (open) {
      if (goodOpen) return high
      if (avgOpen) return average
      return low
    }
    if (close) {
      if (goodClose) return high
      if (avgClose) return average
      return low
    }
  }
  private calcScore(value, scoreConf) {
    for (let p in scoreConf) {
      let val = scoreConf[value]

      if (val)
        return val
      if (p.charAt(0) === '>') {
        if (value > parseInt(p.slice(1)))
          return scoreConf[p]
      }
      let range = p.split('-')
      if (range.length === 2) {
        if (value > parseInt(range[0].replace(/[^\w\s]/gi, ''))  &&  value <= parseInt(range[1].replace(/[^\w\s]/gi, '')))
          return scoreConf[p]
      }
    }
    return 0
  }
  async getItems(aApp) {
    let { items } = await this.bot.db.find({
      filter: {
        EQ: {
          [TYPE]: PRODUCT_REQUEST,
          parent: aApp._permalink
        }
      }
    })
    if (!items || !items.length) {
      // this.logger.debug('Child applications were not submitted yet. Nothing further to check')
      return []
    }

    const prReq: ITradleObject[] = items
    ;({ items } = await this.bot.db.find({
      filter: {
        EQ: {
          [TYPE]: APPLICATION
        },
        IN: {
          context: prReq.map(r => r.contextId)
        }
      }
    }))
    return items
  }
}
export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const scoringReport = new ScoringReport({bot, applications, conf, logger})
  const plugin: IPluginLifecycleMethods = {
    onFormsCollected: async ({ req }: { req: IPBReq }) => {
      let { application } = req

      if (!application) return
      debugger
      const { products, creditBuroScoreForApplicant, creditBuroScoreForEndorser, capacityToPay } = conf
      const { requestFor, checks } = application

      if (!products                     ||
          !creditBuroScoreForApplicant  ||
          !creditBuroScoreForEndorser   ||
          !capacityToPay) return

      const { models } = bot
      if (!products[requestFor]) return
      // Check if it's the child application that is completed
      // if (!products[requestFor]) {
      //   if (!application.parent  ||  !application.checks) return
      //   let icheck: any = await getLatestCheck({
      //     type: CREDIT_REPORT_CHECK,
      //     req,
      //     application,
      //     bot
      //   })
      //   if (!icheck) return
      //   let app = await bot.getResource(application.parent)
      //   const type = app.requestFor
      //   if (!products[type]) return
      //   if (!app.creditScore) return

      //   let creditScore = await bot.getResource(app.creditScore)
      //   let cosignerCreditBureauScore = isPassedCheck(icheck) ? 3 : 0
      //   await bot.versionAndSave({...creditScore, cosignerCreditBureauScore })
      //   return
      // }
      let { forms:formList, resultForm } = products[requestFor]
      if (!formList  ||  !resultForm) return

      if (!checks) return

      let cChecks:any = checks.filter(check => check[TYPE] === CREDIT_REPORT_CHECK)
      if (!cChecks.length) return

      cChecks = await Promise.all(cChecks.map(c => bot.getResource(c)))
      cChecks.sort((a, b) => b._time - a._time)

      let check = await bot.getResource(cChecks[0])

      if (!isPassedCheck({status: check.status})) return

      let forms = application.forms
      if (!forms)
        forms = application.submissions.filter(
          s => bot.models[s.submission[TYPE]].subClassOf === 'tradle.Form'
        )

      let stubs:any = forms && forms.filter(form => formList.indexOf(form.submission[TYPE]) !== -1)
      if (!stubs.length) return

      stubs = stubs.map(s => s.submission)

      let reportForms = await Promise.all(stubs.map(s => bot.getResource(s)))

      let items = application.items
      if (!items) {
        items = await scoringReport.getItems(application)
        // if (!items) return
      }

      let creditScore = await scoringReport.exec({ reportForms, resultForm, items, check, application })
      if (creditScore) {
        let cr = creditScore.resource
        application.creditScore = buildResourceStub({ resource: cr, models })
      }
    },
    // async didApproveApplication(opts: IWillJudgeAppArg, certificate: ITradleObject) {
    //   let { application, user, req } = opts

    //   if (!application || !req) return

    //   if (!application.parentApplication) return

    //   const { products, creditBuroScoreForApplicant, creditBuroScoreForEndorser, capacityToPay } = conf

    //   if (!products                     ||
    //       !creditBuroScoreForApplicant  ||
    //       !creditBuroScoreForEndorser   ||
    //       !capacityToPay) return

    //   const app = bot.getResource(application.parentApplication, {backlinks: ['forms', 'checks']})
    //   if (!products[app.requestFor]) return
    //   let requestFor = app.requestFor

    //   let { forms:formList, resultForm } = products.requestFor
    //   if (!formList  ||  !resultForm) return

    //   let params = this.getResourcesForScoring(application, formList)

    //   await scoringReport.exec({ ...params, resultForm })
    // },
  //   async getResourcesForScoring(application) {
  //     let checks = application.checks
  //     if (!checks) return

  //     let cChecks:any = checks.filter(check => check[TYPE] === CREDS_CHECK)
  //     if (!cChecks) return

  //     cChecks = await Promise.all(cChecks.map(c => bot.getResource(c)))
  //     cChecks.sort((a, b) => b._time - a._time)

  //     let forms = application.forms
  //     if (!forms)
  //       forms = application.submissions.filter(
  //         s => bot.models[s.submission[TYPE]].subClassOf === 'tradle.Form'
  //       )

  //     let stubs:any = forms && forms.filter(form => formList.indexOf(form.submission[TYPE]) !== -1)
  //     if (!stubs.length) return

  //     stubs = stubs.map(s => s.submission)

  //     let check = await bot.getResource(cChecks[0])
  //     if (check.status.id !== `${CHECK_STATUS}_pass`) return

  //     let reportForms = await Promise.all(stubs.map(s => bot.getResource(s)))

  //     let items = application.items
  //     if (!items) {
  //       items = await scoringReport.getItems(application)
  //       // if (!items) return
  //     }

  //     let reportResources = await Promise.all(stubs.map(s => bot.getResource(s)))
  //     return { reportForms, items, check, application }
  //   }
  }

  return { plugin }
}
export const validateConf: ValidatePluginConf = async ({
  bot,
  conf,
  pluginConf
}: {
  bot: Bot
  conf: any
  pluginConf: any
}) => {
  if (!pluginConf) throw new Error(`there is no configuration`)
  const { products, creditBuroScoreForApplicant, creditBuroScoreForEndorser, capacityToPay, accountsScore } = pluginConf
  if (!products) throw new Error(`there is no 'products'`)
  const { models } = bot
  for (let p in products) {
    if (!models[p])  throw new Error(`there is no model ${p}`)
    const { forms, resultForm } = products[p]
    if (!forms)  throw new Error(`there is no 'forms' for product ${p} in configuration`)
    // if (!resources)   new Error(`there is no 'resources' in 'products' in configuration`)
    if (!resultForm)  throw new Error(`there is no 'resultForm' in 'products' configuration`)
    let noModels = []
    forms.forEach(f => {
      if (!models[f]) noModels.push(f)
    })
    if (!models[resultForm]) noModels.push(resultForm)
    if (noModels.length) throw new Error(`There is no models ${noModels}`)
    const { high, average, low } = accountsScore
    if (!high || !average || !low) throw new Error(`accountsScore should have: high, average and low integer values`);
    if (high < average || high < low || average < low) throw new Error(`'high' should be the bigest score, 'average' bigger then 'low'`);
  }
}
