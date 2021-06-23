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
import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

import { getEnumValueId } from '../../utils'
import { isPassedCheck } from '../utils'

const CASH_FLOW = 'PersonalCashflow'
const QUOTATION_INFORMATION = 'QuotationInformation'
const QUOTATION_DETAILS = 'QuotationDetails'
const APPLICANT_INFORMATION = 'ApplicantInformation'
const APPLICANT_ADDRESS = 'ApplicantAddress'
const APPLICANT_MED_PROFESSION = 'ApplicantMedicalProfession'
const LEGAL_ENTITY = 'LegalEntity'
// const LEGAL_ENTITY = 'tradle.legal.LegalEntity'
// const CP = 'tradle.legal.LegalEntityControllingPerson'

const COMPANY_FINANCIALS = 'CompanyFinancialDetails'

const CREDIT_REPORT_CHECK = 'tradle.CreditReportIndividualCheck'
const CREDS_CHECK = 'tradle.CredentialsCheck'
const CREDS_CHECK_OVERRIDE = 'tradle.CredentialsCheckOverride'

const CREDS_COMPANY_CHECK = 'tradle.CreditReportLegalEntityCheck'
const PRODUCT_REQUEST = 'tradle.ProductRequest'
const APPLICATION = 'tradle.Application'
const ONE_YEAR_MILLIS = 60 * 60 * 24 * 365 * 1000
const ASSET_GROUP = 'assetScore'
const CHARACTER_GROUP = 'characterScore'
const PAYMENT_GROUP = 'paymentScore'

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
//   PersonalCashflow: ['extraEquipmentFactor'],
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
  public async execForIndividual({ applicantInformation, reportForms, resultForm, items, check, application }) {
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
    const { models } = this.bot
    let val = this.getEnumValue(applicantInformation, 'existingCustomerRating')

    let existingCustomer = val &&  val.score || 0
    let scoreDetails: any = []
    this.addToScoreDetails({scoreDetails, form: applicantInformation, formProperty: 'existingCustomerRating', property: 'existingCustomer', score: existingCustomer, group: CHARACTER_GROUP});

    let yearsAtWork = 0
    const applicantMedicalProfession = map[APPLICANT_MED_PROFESSION]
    if (applicantMedicalProfession) {
      if (applicantMedicalProfession.yearsAtWork) {
        val = this.getEnumValue(applicantMedicalProfession, 'yearsAtWork')
        yearsAtWork = val.score
        this.addToScoreDetails({scoreDetails, form: applicantMedicalProfession, formProperty: 'yearsAtWork', property: 'yearsAtWork', score: yearsAtWork, group: CHARACTER_GROUP});
      }
    }
    const applicantAddress = map[APPLICANT_ADDRESS]
    let yearsAtResidence = 0
    if (applicantAddress.yearsAtResidence) {
      val = this.getEnumValue(applicantAddress, 'yearsAtResidence')
      yearsAtResidence = val.score
      this.addToScoreDetails({scoreDetails, form: applicantAddress, formProperty: 'yearsAtResidence', property: 'yearsAtResidence', score: yearsAtResidence, group: CHARACTER_GROUP});
    }
    const capacityToPayConf = this.conf.capacityToPay
    const extraEquipmentFactor = map[CASH_FLOW] && map[CASH_FLOW].extraEquipmentFactor
    let capacityToPay = extraEquipmentFactor && this.calcScore(extraEquipmentFactor, capacityToPayConf) || 0

    let { creditBureauScore, accountsPoints, cbReport } = await this.scoreFromCheckIndividual({ item: application, creditReport, check })
    this.addToScoreDetails({scoreDetails, form: cbReport && cbReport.creditScore, formProperty: 'scoreValue', property: 'creditBureauScore', score: creditBureauScore, group: CHARACTER_GROUP});

    let specialityCouncil = 0
    let { cCheck, checkPassed } = await this.credentialsCheckPass(application)
    if (checkPassed) {
      specialityCouncil = 3
      this.addToScoreDetails({scoreDetails, form: cCheck, formProperty: 'status', property: 'specialityCouncil', score: specialityCouncil, group: CHARACTER_GROUP});
    }

    let cosignerCreditBureauScore = 0
    // if (items  &&  items.length) {
    //   items = await Promise.all(items.map(item => this.bot.getResource(item, {backlinks: ['checks']})))
    //   // for (let i=0; i<items.length; i++) {
    //   let cosignerScores = await this.scoreFromCheckIndividual({ item: items[0], isEndorser: true})
    //   cosignerCreditBureauScore = cosignerScores.creditBureauScore
    // }
    let { maxScores } = this.conf
    
    const {asset, usefulLife, secondaryMarket, relocation, assetType, leaseType} = await this.getCommonScores(map, scoreDetails)
    const characterScore = creditBureauScore + existingCustomer + yearsAtWork + yearsAtResidence
    this.addToScoreDetails({scoreDetails, property: 'characterScore', score: characterScore, group: CHARACTER_GROUP, total: true, maxScores});

    const assetScore = usefulLife + secondaryMarket + relocation + assetType + leaseType

    this.addToScoreDetails({scoreDetails, form: asset, property: 'assetScore', score: assetScore, group: ASSET_GROUP, total: true, maxScores});

    let props:any = {
      creditBureauScore,
      existingCustomer,
      specialityCouncil,
      yearsAtWork,
      yearsAtResidence,
      characterScore,
      capacityToPay,
      usefulLife,
      secondaryMarket,
      relocation,
      assetType,
      leaseType,
      cosignerCreditBureauScore,
      accounts: accountsPoints,
      assetScore,
      // check
    }
    let { formula } = capacityToPayConf
    if (formula) {
      let props1 = {...map[CASH_FLOW], capacityToPay}

      let keys = Object.keys(props1)
      let values = Object.values(props1)
      try {
        let newCapacityToPay = new Function(...keys, `return ${formula}`)(...values)
        if (newCapacityToPay)
          capacityToPay = newCapacityToPay
      } catch (err) {
        debugger
      }
    }
    
    if (capacityToPay) {
      this.addToScoreDetails({scoreDetails, form: map[CASH_FLOW], formProperty: 'extraEquipmentFactor', property: 'capacityToPay', score: capacityToPay, group: PAYMENT_GROUP});
      this.addToScoreDetails({scoreDetails, form: map[CASH_FLOW], formProperty: 'extraEquipmentFactor', property: 'paymentScore', score: capacityToPay, group: PAYMENT_GROUP, total: true, maxScores});
    }
    props.capacityToPay = capacityToPay
    props.paymentScore = capacityToPay

    props.totalScore = characterScore + props.paymentScore + assetScore
    this.addToScoreDetails({scoreDetails, property: 'totalScore', score: props.totalScore, total: true});
  
    let score = await this.bot.draft({ type: resultForm }).set(props).signAndSave()
    return { score, scoreDetails }
  }
  public async execForCompany({ applicantInformation, reportForms, resultForm, items, check, application }) {
    let map = {}
    reportForms.forEach(f => {
      const type = f[TYPE].split('.').slice(-1)[0]
      if (!map[type])
        map[type] = []
      map[type].push(f)
    })
    let { creditReport } = check
    if (!creditReport) return
    let scoreDetails: any = []
    creditReport = await this.bot.getResource(creditReport, {backlinks: ['generalData', 'accounts', 'commercialCredit' ]})
    let { generalData, accounts } = creditReport
    generalData = generalData  &&  await this.bot.getResource(generalData[0])
    let financialRating = generalData  &&  generalData.financialRating
    let ratingInBureau = 0
    if (financialRating) {
      let s = financialRating.slice(-2)
      if (s === 'A1' || s === 'B2' || s === 'NC' || s === 'EX')
        ratingInBureau = 2
    }
    else
      ratingInBureau = 2
    this.addToScoreDetails({scoreDetails, form: generalData, formProperty: 'financialRating', property: 'ratingInBureau', score: ratingInBureau, group: CHARACTER_GROUP});

    let worstMopThisYear = 0
    accounts = accounts && await Promise.all(accounts.map(r => this.bot.getResource(r)))
    if (accounts) {
      let score = 2
      let goodAccounts = 0
      let score12 = 2
      for (let i=0; i<accounts.length; i++) {
        let acc = accounts[i]
        const { history, closedDate } = acc 
        if (!history  ||  closedDate) continue
        if (hasDigitsBigerThan(history, 4)) 
          score = 0        
        else if (history.indexOf('4') !== -1)
          score = score < 2 ? score : 1
        else
          goodAccounts++
        let history12 = history.length > 12 ? history.slice(0, 12) : history
        if (hasDigitsBigerThan(history12, 4))
          score12 = 0
        else if (history12.indexOf('4') !== -1)
          score12 = score12 < 2 ? score12 : 1
      }
      this.addToScoreDetails({scoreDetails, form: generalData, formProperty: 'accounts', property: 'recentMonthsInArrears', score, group: CHARACTER_GROUP});
      let percentageOfGoodAccounts = goodAccounts * 100/accounts.length
      percentageOfGoodAccounts  = percentageOfGoodAccounts > 80 ? 2 : 0
      this.addToScoreDetails({scoreDetails, form: generalData, formProperty: 'accounts', property: 'percentageOfGoodAccounts', score, group: CHARACTER_GROUP});
      this.addToScoreDetails({scoreDetails, form: generalData, formProperty: 'accounts', property: 'worstMopThisYear', score: score12, group: CHARACTER_GROUP});
    }

    let commercialCredit = creditReport.commercialCredit
    if (commercialCredit) {
      commercialCredit = await Promise.all(commercialCredit.map(r => this.bot.getResource(r)))
    }
    let legalEntity = map[LEGAL_ENTITY]
    if (legalEntity) legalEntity = legalEntity[0]
    let yearsInOperation = 0, ownFacility = 0
    if (legalEntity) {
      if (legalEntity.registrationDate / ONE_YEAR_MILLIS )
        yearsInOperation = 1
      if (legalEntity.ownsFacility) 
        ownFacility = 1
    }
    this.addToScoreDetails({scoreDetails, form: legalEntity, formProperty: 'registrationDate', property: 'yearsInOperation', score: yearsInOperation, group: CHARACTER_GROUP});
    this.addToScoreDetails({scoreDetails, form: legalEntity, formProperty: 'ownFacility', property: 'ownFacility', score: ownFacility, group: CHARACTER_GROUP});

    let financialDetails = map[COMPANY_FINANCIALS]
    const companyFinancials:any = this.calculateCompanyFinancials(financialDetails, scoreDetails)

    const {asset, usefulLife, secondaryMarket, relocation, assetType, leaseType} = await this.getCommonScores(map, scoreDetails)
    // const characterScore = creditBureauScore + existingCustomer + yearsAtWork + yearsAtResidence
    // const paymentScore = capacityToPay
    let { maxScores } = this.conf
    
    const assetScore = usefulLife + secondaryMarket + relocation + assetType + leaseType
    this.addToScoreDetails({scoreDetails, form: asset, property: 'assetScore', score: assetScore, group: ASSET_GROUP, total: true, maxScores});
    const characterScore = yearsInOperation + ownFacility + ratingInBureau
    this.addToScoreDetails({scoreDetails, property: 'characterScore', score: characterScore, group: CHARACTER_GROUP, total: true, maxScores});
    let paymentScore = 0
    for (let p in companyFinancials)
      paymentScore += companyFinancials[p]
    let props = {
      ...companyFinancials,
      ratingInBureau,
      worstMopThisYear,
      yearsInOperation,
      ownFacility,
      usefulLife,
      secondaryMarket,
      relocation,
      assetScore,
      assetType,
      leaseType,
      characterScore,
      paymentScore,
      // cosignerCreditBureauScore,
      // accounts: accountsPoints,
      totalScore: characterScore + companyFinancials.paymentScore + assetScore,
    }
    this.addToScoreDetails({scoreDetails, property: 'totalScore', score: props.totalScore, total: true});

    let score = await this.bot.draft({ type: resultForm }).set(props).signAndSave()
    return { score, scoreDetails }
  }
  calculateCompanyFinancials(financialDetails, scoreDetails) {
    if (!financialDetails) 
      return {}

    let profitable = 0, liquidity = 0, leverage = 0, technicalBankrupcy = 0, workingCapitalRatio = 0, debtLevel = 0, returnOnEquity = 0, netProfit = 0, debtFactor = 0
    financialDetails.forEach(fd => {
      profitable += fd.netProfitP || 0
      liquidity += fd.acidTest || 0 
      leverage =+ fd.leverage || 0
      technicalBankrupcy += fd.technicalBankrupcy || 0
      workingCapitalRatio += fd.workingCapitalRatio || 0
      debtLevel += fd.indebtedness || 0
      returnOnEquity += fd.returnOnEquity || 0
      netProfit += fd.netProfitP || 0
      debtFactor += fd.extraEquipmentRatio || 0
    })

    const flen = financialDetails.length
    profitable = profitable  ? 2 : 0
    this.addToScoreDetails({scoreDetails, form: financialDetails, property: 'profitable', formProperty: 'netProfitP', score: profitable, group: PAYMENT_GROUP});

    liquidity = (liquidity  &&  liquidity / flen) > 1 ? 2 : 0
    this.addToScoreDetails({scoreDetails, form: financialDetails, property: 'liquidity', formProperty: 'acidTest', score: liquidity, group: PAYMENT_GROUP});

    leverage = leverage && leverage / flen
    if (leverage <= 60) leverage = 2
    else if (leverage < 71) leverage = 1  
    this.addToScoreDetails({scoreDetails, form: financialDetails, property: 'leverage', formProperty: 'leverage', score: leverage, group: PAYMENT_GROUP});
    
    technicalBankrupcy = (technicalBankrupcy / flen) < 33 ? 2 : 0
    this.addToScoreDetails({scoreDetails, form: financialDetails, property: 'technicalBankrupcy', formProperty: 'technicalBankrupcy', score: technicalBankrupcy, group: PAYMENT_GROUP});
    
    workingCapitalRatio /= flen
    if (workingCapitalRatio >= 2) workingCapitalRatio = 2
    else if (workingCapitalRatio < 2  &&  workingCapitalRatio > 1) workingCapitalRatio = 1
    this.addToScoreDetails({scoreDetails, form: financialDetails, property: 'workingCapitalRatio', formProperty: 'workingCapitalRatio', score: workingCapitalRatio, group: PAYMENT_GROUP});

    debtLevel = (debtLevel / flen) < 50 ? 2 : 0
    this.addToScoreDetails({scoreDetails, form: financialDetails, property: 'debtLevel', formProperty: 'indebtedness', score: debtLevel, group: PAYMENT_GROUP});
    returnOnEquity = (returnOnEquity / flen) > 12 ? 2 : 1
    this.addToScoreDetails({scoreDetails, form: financialDetails, property: 'returnOnEquity', formProperty: 'returnOnEquity', score: returnOnEquity, group: PAYMENT_GROUP});
    
    netProfit /= flen
    if (netProfit > 10) netProfit = 2
    if (netProfit < 10  &&  netProfit > 1) netProfit = 1
    this.addToScoreDetails({scoreDetails, form: financialDetails, property: 'netProfit', formProperty: 'netProfitP', score: netProfit, group: PAYMENT_GROUP});

    debtFactor /= flen
    if (debtFactor <= 65) debtFactor = 19
    else if (debtFactor > 54 && debtFactor <= 70) debtFactor = 16
    else if (debtFactor > 70 && debtFactor <= 75) debtFactor = 12
    else if (debtFactor > 75 && debtFactor <= 80) debtFactor = 8
    this.addToScoreDetails({scoreDetails, form: financialDetails, property: 'debtFactor', formProperty: 'extraEquipmentRatio', score: debtFactor, group: PAYMENT_GROUP});

    let paymentScore = profitable + liquidity + leverage + technicalBankrupcy + 
                      workingCapitalRatio + debtLevel + returnOnEquity + netProfit + debtFactor
    const { maxScores } = this.conf
    this.addToScoreDetails({scoreDetails, form: financialDetails, property: 'paymentScore', score: paymentScore, group: PAYMENT_GROUP, total: true, maxScores});
    return {
      profitable,
      liquidity,
      leverage,
      technicalBankrupcy,       
      workingCapitalRatio,
      debtLevel,
      returnOnEquity,
      netProfit,
      debtFactor,
      paymentScore
    }
  }
  private async getCommonScores(map, scoreDetails) {
    let qi = map[QUOTATION_INFORMATION]
    if (qi  &&  Array.isArray(qi))
      qi = qi[0]
    let qd = map[QUOTATION_DETAILS]
    if (qd  &&  Array.isArray(qd))
      qd = qd[0]
    let asset, usefulLife = 0, secondaryMarket = 0, relocation = 0, assetType = 0, leaseType = 0
    if (qi && qi.asset) {
      asset = await this.bot.getResource(qi.asset)
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
      this.addToScoreDetails({scoreDetails, form: asset, formProperty: 'usefulLife', property: 'usefulLife', score: usefulLife, group: ASSET_GROUP});

      val = this.getEnumValue(asset, 'secondaryMarket')
      if (val) {
        secondaryMarket = val.score
      }
      this.addToScoreDetails({scoreDetails, form: asset, formProperty: 'secondaryMarket', property: 'secondaryMarket', score: secondaryMarket, group: ASSET_GROUP});

      val = this.getEnumValue(asset, 'relocationTime')
      if (val) {
        relocation = val.score
      }
      this.addToScoreDetails({scoreDetails, form: asset, formProperty: 'relocation', property: 'relocation', score: relocation, group: ASSET_GROUP});

      val = this.getEnumValue(asset, 'assetType')
      if (val) {
        assetType = val.score
      }
      this.addToScoreDetails({scoreDetails, form: asset, formProperty: 'assetType', property: 'assetType', score: assetType, group: ASSET_GROUP});
      val = this.getEnumValue(asset, 'leaseType')
      if (val) {
        leaseType = val.score
        this.addToScoreDetails({scoreDetails, form: asset, formProperty: 'leaseType', property: 'leaseType', score: leaseType, group: ASSET_GROUP});
      }
    }
    return {
      asset,
      usefulLife,
      secondaryMarket,
      relocation,
      assetType,
      leaseType
    }
  }
  private async credentialsCheckPass(application) {
    const { checks, checkOverrides } = application
    let credsChecks = checks.find(check => check[TYPE] === CREDS_CHECK)
    if (!credsChecks || !credsChecks.length)
      return {}
    let cChecks:any = await Promise.all(credsChecks.map(c => this.bot.getResource(c)))
    cChecks.sort((a, b) => b._time - a._time)
    let credsCheck = await this.bot.getResource(credsChecks[0])
    if (checkOverrides)  {
      let credsCheckOverride = cChecks.find(co => co[TYPE] === CREDS_CHECK_OVERRIDE)
      if (credsCheckOverride)
        return { checkPassed: isPassedCheck({status: credsCheckOverride.status}), cCheck: credsCheckOverride }
    }
    return { checkPassed: isPassedCheck({status: credsCheck.status}), cCheck: credsCheck }
  }
  private addToScoreDetails({scoreDetails, form, formProperty, property, score, group, total, maxScores}:{
    scoreDetails:any
    form?: any
    formProperty?: string
    property: string
    score: number
    group?:string
    total?: boolean
    maxScores?: any
  }) {
    let formStub
    const { models } = this.bot
    // could be multientry form like for CompanyFinancialDetails
    if (form) {
      if (Array.isArray(form)) 
        formStub = form.map(f => buildResourceStub({resource: f, models }))
      else
        formStub =  buildResourceStub({ resource: form, models })
    }
    let detail:any = {
      score,
      property,
      group,
      total,
      formProperty,
      form: form && formStub,
      max: total && maxScores && maxScores[property]
    }
    detail = sanitize(detail).sanitized
    scoreDetails.push(detail)  
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
  private async scoreFromCheckIndividual({item, isEndorser, check, creditReport}:{item:any, isEndorser?: boolean, check?:any, creditReport?:any}) {
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

    return { creditBureauScore, accountsPoints, cbReport: creditReport }
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
    let close = 0, open = 0, 
        goodOpen = 0, goodClose = 0, 
        avgOpen = 0, avgClose = 0, 
        badOpen = 0, badClose = 0
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
      else {
        let isNumber = /^[0-9]$/.test(p.charAt(0))
        if (!isNumber) continue
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
      // debugger
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
      let { formsIndividual, formsCompany, reportIndividual, reportCompany } = products[requestFor]

      if (!checks) return

      let { forms } = application
      if (!forms)
        forms = application.submissions.filter(
          s => bot.models[s.submission[TYPE]].subClassOf === 'tradle.Form'
        )

      let applicantInformationSubmission = forms.find(form => form.submission[TYPE].endsWith(`.${APPLICANT_INFORMATION}`))
      if (!applicantInformationSubmission) return

      let applicantInformationStub = applicantInformationSubmission.submission
      const applicantInformation = await bot.getResource(applicantInformationStub)
      const { applicant } = applicantInformation
      let isCompany
      if (applicant) {
        const ref = models[applicantInformation[TYPE]].properties.applicant.ref
        let val = getEnumValueId({
          model: models[ref],
          value: applicant
        })
        isCompany = val === 'company'
      }

      let formList = isCompany  ? formsCompany :  formsIndividual
      if (!formList) return

      let resultForm = isCompany ? reportCompany : reportIndividual
      if (!resultForm) return

      let stubs:any = forms && forms.filter(form => formList.indexOf(form.submission[TYPE]) !== -1)
      if (!stubs.length) return

      stubs = stubs.map(s => s.submission)
      let applicantInformationStubIdx = stubs.findIndex(form => form[TYPE].endsWith(`.${APPLICANT_INFORMATION}`))

      stubs.splice(applicantInformationStubIdx, 1)

      let checkType = isCompany ? CREDS_COMPANY_CHECK : CREDIT_REPORT_CHECK
      let cChecks:any = checks.filter(check => check[TYPE] === checkType)
      if (!cChecks.length) return
      cChecks = await Promise.all(cChecks.map(c => bot.getResource(c)))
      cChecks.sort((a, b) => b._time - a._time)

      let check = await bot.getResource(cChecks[0])

      if (!isPassedCheck({status: check.status})) return

      let reportForms = await Promise.all(stubs.map(s => bot.getResource(s)))

      let items = application.items
      if (!items) {
        items = await scoringReport.getItems(application)
        // if (!items) return
      }

      let score, scoreDetails
      if (isCompany)
        ({ score, scoreDetails } = await scoringReport.execForCompany({applicantInformation, reportForms, resultForm, items, check, application }))
      else
        ({ score, scoreDetails } =  await scoringReport.execForIndividual({applicantInformation, reportForms, resultForm, items, check, application }))

      if (score) {
        let cr = score.resource
        application.creditScore = buildResourceStub({ resource: cr, models })
        if (scoreDetails)
          application.creditScoreDetails = scoreDetails
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
    const { formsIndividual, formsCompany, reportCompany, reportIndividual } = products[p]
    if (!formsCompany && !formsIndividual)  throw new Error(`there is no 'forms' for product ${p} in configuration`)
    // if (!resources)   new Error(`there is no 'resources' in 'products' in configuration`)
    if (!reportCompany  &&  !reportIndividual)  throw new Error(`there is no 'reportCompany' or 'reportIndividual' in 'products' configuration`)
    let noModels = []
    if (formsCompany) {
      formsCompany.forEach(f => {
        if (!models[f]) noModels.push(f)
      })
    }
    if (formsIndividual) {
      formsIndividual.forEach(f => {
        if (!models[f]) noModels.push(f)
      })
    }
    if (reportIndividual && !models[reportIndividual]) noModels.push(reportIndividual)
    if (reportCompany && !models[reportCompany]) noModels.push(reportCompany)
    if (noModels.length) throw new Error(`There is no models ${noModels}`)
    const { high, average, low } = accountsScore
    if (!high || !average || !low) throw new Error(`accountsScore should have: high, average and low integer values`);
    if (high < average || high < low || average < low) throw new Error(`'high' should be the bigest score, 'average' bigger then 'low'`);
  }
}
function hasDigitsBigerThan(str, digit) {
  for (let i=digit + 1; i<10; i++) {
    if (str.indexOf('' + i) !== -1) return true 
  } 
  return false
}
