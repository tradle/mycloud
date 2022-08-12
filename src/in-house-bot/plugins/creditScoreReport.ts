import { TYPE } from '@tradle/constants'
import {
  Bot,
  CreatePlugin,
  IPBReq,
  IPluginLifecycleMethods,
  ValidatePluginConf,
  ITradleObject,
  Applications,
  Logger,
  ITradleCheck
} from '../types'
import { buildResourceStub } from '@tradle/build-resource'
import validateResource from '@tradle/validate-resource'
import extend from 'lodash/extend'
import pick from 'lodash/pick'
// @ts-ignore
const { sanitize } = validateResource.utils

import { getEnumValueId } from '../../utils'
import { isPassedCheck, getLatestForms, isSubClassOf } from '../utils'

const CASH_FLOW = 'PersonalCashflow'
const COMPANY_CASH_FLOW = 'CompanyCashflow'
const QUOTE = 'Quote'

const APPLICANT_INFORMATION = 'ApplicantInformation'
const APPLICANT_ADDRESS = 'ApplicantAddress'
const APPLICANT_MED_PROFESSION = 'ApplicantMedicalProfession'
const LEGAL_ENTITY = 'LegalEntity'
const FORM = 'tradle.Form'

const COMPANY_FINANCIALS = 'CompanyFinancialDetails'

const CREDIT_REPORT_CHECK = 'tradle.CreditReportIndividualCheck'
const CREDS_CHECK = 'tradle.CredentialsCheck'
const CREDS_CHECK_OVERRIDE = 'tradle.CredentialsCheckOverride'

const CREDS_COMPANY_CHECK = 'tradle.CreditReportLegalEntityCheck'
const PRODUCT_REQUEST = 'tradle.ProductRequest'
const DATA_BUNDLE_SUMBITTED = 'tradle.DataBundleSubmitted'

const APPLICATION = 'tradle.Application'
const ONE_YEAR_MILLIS = 31556952000 // 60 * 60 * 24 * 365 * 1000
const ASSET_GROUP = 'assetScore'
const CHARACTER_GROUP = 'characterScore'
const PAYMENT_GROUP = 'paymentScore'

type ScoringReportOpts = {
  bot: Bot
  conf: any
  applications: Applications
  logger: Logger
  productsAPI: any
}
export class ScoringReport {
  private bot: Bot
  private conf: any
  private applications: Applications
  private logger: Logger
  private productsAPI: any
  constructor({ bot, conf, applications, logger, productsAPI }: ScoringReportOpts) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
    this.logger = logger
    this.productsAPI = productsAPI
  }
  async runReport({application, conf, parentFormsStubs, dataOnly}: {application: any, conf: any, parentFormsStubs: any, dataOnly?: boolean}) {
    const { products } = conf
    const { requestFor } = application
    let resultForm
    let data = await this.getCreditScoringData({application, conf, parentFormsStubs})
    if (!data)
      return
    let { reportIndividual, reportCompany } = products[requestFor]
    let { isCompany } = data
    let inputData, additionalData, props
    if (isCompany) {
      resultForm = reportCompany
      let result = await this.getDataForCompany(data)
      ;({inputData, additionalData} = result)
      extend(data, additionalData)
      props = this.calcForCompany(inputData)
    }
    else {
      resultForm = reportIndividual
      let result = await this.getDataForIndividual(data)
      ;({inputData, additionalData} = result)
      extend(data, additionalData)
      props = this.calcForIndividual(inputData)
    }
    if (dataOnly)
      return inputData
    this.productsAPI._exec('willSaveResource', { application, resource: props });

    let score = await this.bot.draft({ type: resultForm }).set(props).signAndSave()
    if (score) {
      let cr = score.resource
      application.creditScoreDetails = isCompany ? this.createCompanyScoreDetails(props, data) : this.createIndividualScoreDetails(props, data)
      application.creditScore = buildResourceStub({ resource: cr, models: this.bot.models })
    }
    return inputData
  }
  async getCreditScoringData({application, conf, parentFormsStubs}) {
    const { products, creditBuroScoreForApplicant, creditBuroScoreForEndorser, capacityToPay } = conf
    let { requestFor, checks, parent } = application

    if (!products                     ||
        !creditBuroScoreForApplicant  ||
        !creditBuroScoreForEndorser   ||
        !capacityToPay) return

    const { models } = this.bot
    if (!products[requestFor]) return
    let parentApp, parentChecks
    if (parent) {
      let backlinks = ['checks', 'checksOverride']
      if (!parentFormsStubs) backlinks.push('forms')
        let {checks, forms, checksOverride} = await this.bot.getResource(parent, {backlinks})
      parentChecks = checks
      parentApp = {parentChecks, parentChecksOverride: checksOverride}
      if (forms)
        parentFormsStubs = getLatestForms({forms}).filter(f => f.type !== PRODUCT_REQUEST && isSubClassOf(FORM, models[f.type], models))
    }
    let { formsIndividual, formsCompany, reportIndividual, reportCompany } = products[requestFor]

    if (!checks  &&  !parentChecks) {
      this.logger.debug(`creditScoreReport: no check were found`)
      return
    }
    let allChecks: ITradleCheck[]
    if (!checks)
      allChecks = [...parentChecks]
    else if (parentChecks)
      allChecks = [...checks, ...parentChecks]
    else
      allChecks = [...checks]

    let forms = getLatestForms(application)
    if (!forms)
      forms = application.submissions.filter(
        s => this.bot.models[s.submission[TYPE]].subClassOf === 'tradle.Form'
      )
    let applicantInformationStub = forms.find(form => form.type.endsWith(`.${APPLICANT_INFORMATION}`))
    if (!applicantInformationStub) {
      if (parentFormsStubs)
        applicantInformationStub = parentFormsStubs.find(form => form.type.endsWith(`.${APPLICANT_INFORMATION}`))
      if (!applicantInformationStub) {
        this.logger.debug('creditScoreReport: no ApplicantInformation was found')
        return
      }
    }

    const applicantInformation = await this.bot.getResource(applicantInformationStub)
    const { applicant } = applicantInformation
    let isCompany
    if (applicant) {
      const ref = models[applicantInformation[TYPE]].properties.applicant.ref
      let val = getEnumValueId({
        model: models[ref],
        value: applicant
      })
      isCompany = val === 'company' || val === 'medical'
    }

    let formList = isCompany  ? formsCompany :  formsIndividual
    if (!formList) return

    let resultForm = isCompany ? reportCompany : reportIndividual
    if (!resultForm) return

    let stubs:any = forms && forms.filter(form => formList.indexOf(form.type) !== -1)
    if (!stubs.length  &&  !parentFormsStubs) {
      this.logger.debug('creditScoreReport: no forms to make report from were found')
      return
    }

    // stubs = stubs.map(s => s.submission)
    if (parentFormsStubs) {
      let pForms = parentFormsStubs.filter(f => formList.indexOf(f.type) !== -1)
      pForms.forEach(f => stubs.push(f))
    }

    let applicantInformationStubIdx = stubs.findIndex(form => (form[TYPE] || form.type).endsWith(`.${APPLICANT_INFORMATION}`))

    stubs.splice(applicantInformationStubIdx, 1)

    let checkType = isCompany ? CREDS_COMPANY_CHECK : CREDIT_REPORT_CHECK
    let cChecks:any = allChecks.filter(check => check[TYPE] === checkType)
    if (!cChecks.length) {
      this.logger.debug(`creditScoreReport: no ${checkType} check was found`)
      return
    }
    cChecks = await Promise.all(cChecks.map(c => this.bot.getResource(c)))
    cChecks.sort((a, b) => b._time - a._time)

    let check = await this.bot.getResource(cChecks[0])

    if (!isPassedCheck({status: check.status})) {
      this.logger.debug(`creditScoreReport: ${checkType} nor passed`)
      return
    }
    let { creditReport } = check
    if (!creditReport) return

    let reportForms = await Promise.all(stubs.map(s => this.bot.getResource(s)))

    let items = application.items
    if (!items) {
      // items = await this.getItems(application)
      // if (!items) return
    }
    let map = {}
    reportForms.forEach(f => {
      map[f[TYPE].split('.').slice(-1)[0]] = f
    })
    map[APPLICANT_INFORMATION] = applicantInformation
    let quote:any = map[QUOTE]
    if (Array.isArray(quote)) {
      if (quote.length)
        quote = quote[0]
    }
    let asset = await this.bot.getResource(quote.asset)

    return { asset, quote, isCompany, creditReport, map, resultForm, items, check, parentApp, application }
  }
  public async getDataForIndividual({ asset, map, quote, creditReport, check, application, parentApp }) {
    creditReport = await this.bot.getResource(creditReport, {backlinks: ['accounts', 'creditScore' ]})
    const { crCreditScore, crAccounts, cbReport, cCheck, checkPassed } = await this.getScoreDataForIndividual({ application, creditReport, check, parentApp })
    let accounts:any = await Promise.all(crAccounts.map(a => this.bot.getResource(a)))

    const applicantMedicalProfession = map[APPLICANT_MED_PROFESSION]
    const applicantAddress = map[APPLICANT_ADDRESS]
    const cashflow = map[CASH_FLOW] || {}
    const { creditBuroScoreForEndorser, creditBuroScoreForApplicant } = this.conf
    const applicantInformation = map[APPLICANT_INFORMATION]
    let enums = {
      applicantInformation: {
        existingCustomerRating: this.getEnumValue(applicantInformation, 'existingCustomerRating'),
        yearsAtResidence: this.getEnumValue(applicantAddress, 'yearsAtResidence'),
        yearsAtWork: applicantMedicalProfession && this.getEnumValue(applicantMedicalProfession, 'yearsAtWork')
      },
      asset: {
        usefulLife: this.getEnumValue(asset, 'usefulLife'),
        secondaryMarket: this.getEnumValue(asset, 'secondaryMarket'),
        relocationTime: this.getEnumValue(asset, 'relocationTime'),
        assetType: this.getEnumValue(asset, 'assetType')
      },
      quote: {
        leaseType: this.getEnumValue(quote, 'leaseType')
      }
    }
    const inputData:any = {
      enums,
      checkPassed, // credentials check
      cbScoreMap: creditBuroScoreForApplicant,
      capacityToPayConf: this.conf.capacityToPay,
      creditReport: {
        creditScore: crCreditScore,
      },
      crCreditScore: {
        scoreValue: crCreditScore.scoreValue
      },
      cashflow: {
        extraEquipmentFactor: cashflow.extraEquipmentFactor,
        verifiableFactor: cashflow.verifiableFactor,
        incomeFactor: cashflow.incomeFactor
      },
      accountsData: accounts && accounts.map(acc => pick(acc, ['totalMop2', 'totalMop3', 'totalMop4', 'totalMop5', 'accountClosingDate'])),
      cbReport: {
        creditScore: cbReport.creditScore.scoreValue
      },
      applicantInformation: {
        [TYPE]: applicantInformation[TYPE],
        existingCustomerRating: applicantInformation.existingCustomerRating,
        medical: applicantInformation.medical
      },
      applicantAddress: {
        [TYPE]: applicantAddress[TYPE],
        yearsAtResidence: applicantAddress.yearsAtResidence
      },
      asset: {
        [TYPE]: asset[TYPE],
        usefulLife: asset.usefulLife,
        secondaryMarket: asset.secondaryMarket,
        relocationTime: asset.relocationTime,
        assetType: asset.assetType,
      },
      quote: {
        [TYPE]: quote[TYPE],
        term: quote.term,
        leaseType: asset.leaseType
      }
    }
    if (applicantMedicalProfession) {
      inputData.applicantMedicalProfession = {
        [TYPE]: applicantMedicalProfession[TYPE],
        yearsAtWork: applicantMedicalProfession.yearsAtWork
      }
    }
    const additionalData = {
      crCreditScore,
      cbReport,
      cCheck,
    }
    return {inputData, additionalData}
  }
  private async getScoreDataForIndividual({application, creditReport, parentApp}:{application:any, isEndorser?: boolean, check?:any, creditReport?:any, parentApp: any}) {
    if (application.status !== 'approved'  &&  application.status !== 'completed') return {}

    // let creditBureauScore
    let crCreditScore
    if (creditReport.creditScore && creditReport.creditScore.length) {
      crCreditScore = await this.bot.getResource(creditReport.creditScore[0])
    }
    let crAccounts = creditReport.accounts
    let { cCheck, checkPassed } = await this.credentialsCheckPass(application, parentApp)

    return { crCreditScore, crAccounts, cbReport: creditReport, cCheck, checkPassed }
  }
  public calcForIndividual(params) {
    const { applicantInformation, applicantMedicalProfession, applicantAddress, asset, quote, enums, cashflow } = params
    const { cbScoreMap, crCreditScore, accountsData, capacityToPayConf, checkPassed } = params

    let val = enums.applicantInformation.existingCustomerRating
    let existingCustomer = val &&  val.score || 0
    let yearsAtWork = 0
    if (applicantMedicalProfession  &&  applicantMedicalProfession.yearsAtWork) {
      val = enums.applicantMedicalProfession.yearsAtWork
      yearsAtWork = val.score
    }
    let yearsAtResidence = 0
    if (applicantAddress.yearsAtResidence) {
      val = enums.applicantAddress.yearsAtResidence
      yearsAtResidence = val.score
    }

    let capacityToPayFactor
    if (applicantInformation.medical)
      capacityToPayFactor = cashflow.extraEquipmentFactor
    else
      capacityToPayFactor = cashflow.verifiableFactor

    let capacityToPay = capacityToPayFactor && this.calcScore(capacityToPayFactor, capacityToPayConf) || 0

    const {usefulLife, secondaryMarket, relocation, assetType, leaseType} = this.getCommonScores({quote, asset, enums})
    const creditBureauScore = this.calcScore(crCreditScore.scoreValue, cbScoreMap)
    const characterScore = creditBureauScore + existingCustomer + yearsAtWork + yearsAtResidence

    const assetScore = usefulLife + secondaryMarket + relocation + assetType + leaseType

    let accountsPoints =  this.calcAccounts(accountsData)
    let accScore = accountsPoints ? accountsPoints.accScore : 0

    let props:any = {
      creditBureauScore,
      existingCustomer,
      specialityCouncil: checkPassed && 3,
      yearsAtWork,
      yearsAtResidence,
      characterScore,
      capacityToPay,
      usefulLife,
      secondaryMarket,
      relocation,
      assetType,
      leaseType,
      cosignerCreditBureauScore: 0,
      accounts: accScore,
      assetScore,
      // totalScore
      // check
    }
    let { formula } = capacityToPayConf
    if (formula) {
      let props1 = {...cashflow, capacityToPay}

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
    let paymentScore = capacityToPay
    props.totalScore = characterScore + paymentScore + assetScore
    props = sanitize(props).sanitized
    return props
  }
  private getCommonScores({quote, asset, enums}: {quote: any, asset:any, enums: any}) {
    let usefulLife = 0, secondaryMarket = 0, relocation = 0, assetType = 0, leaseType = 0
    // const { usefulLife, secondaryMarket, relocationTime, assetType, leaseType } = asset

    let val = enums.asset.usefulLife
    if (val) {
      // let term = this.getEnumValue(qd, 'term', qd.term)
      let term = parseInt(quote.term.title.split(' ')[0]) / 12
      if (val.years > term)
        usefulLife = 7
      else if (val.years === term)
        usefulLife = 5
      else
        usefulLife = 0
    }
    // if (!scoreDetails)
    //   scoreDetails = []
    // this.addToScoreDetails({scoreDetails, form: asset, formProperty: 'usefulLife', property: 'usefulLife', score: usefulLife, group: ASSET_GROUP});

    val = enums.asset.secondaryMarket
    if (val) {
      secondaryMarket = val.score
    }
    // this.addToScoreDetails({scoreDetails, form: asset, formProperty: 'secondaryMarket', property: 'secondaryMarket', score: secondaryMarket, group: ASSET_GROUP});

    val = enums.asset.relocationTime
    if (val) {
      relocation = val.score
    }
    // this.addToScoreDetails({scoreDetails, form: asset, formProperty: 'relocation', property: 'relocation', score: relocation, group: ASSET_GROUP});

    val = enums.asset.assetType
    if (val) {
      assetType = val.score
    }
    // this.addToScoreDetails({scoreDetails, form: asset, formProperty: 'assetType', property: 'assetType', score: assetType, group: ASSET_GROUP});
    val = enums.quote.leaseType
    if (val) {
      leaseType = val.score
      // this.addToScoreDetails({scoreDetails, form: quote, formProperty: 'leaseType', property: 'leaseType', score: leaseType, group: ASSET_GROUP});
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
  public async getDataForCompany({ asset, map, quote, creditReport, check, application, parentApp }) {
    creditReport = await this.bot.getResource(creditReport, {backlinks: ['generalData', 'accounts', 'commercialCredit' ]})
    let { generalData, accounts, commercialCredit } = creditReport
    generalData = generalData  &&  await this.bot.getResource(generalData[0])

    accounts = accounts && await Promise.all(accounts.map(r => this.bot.getResource(r)))

    if (commercialCredit)
      commercialCredit = await Promise.all(commercialCredit.map(r => this.bot.getResource(r)))

    let enums = {
      asset: {
        usefulLife: this.getEnumValue(asset, 'usefulLife'),
        secondaryMarket: this.getEnumValue(asset, 'secondaryMarket'),
        relocationTime: this.getEnumValue(asset, 'relocationTime'),
        assetType: this.getEnumValue(asset, 'assetType')
      },
      quote: {
        leaseType: this.getEnumValue(quote, 'leaseType')
      }
    }
    let legalEntity = map[LEGAL_ENTITY]
    if (!legalEntity)
      return
    let financialDetails = map[COMPANY_FINANCIALS]
    if (financialDetails)
      financialDetails = pick(financialDetails, [TYPE, 'netProfitP', 'acidTest','leverage', 'technicalBankrupcy', 'workingCapitalRatio', 'indebtedness', 'returnOnEquity', 'returnOnAssets', 'operatingProfitP'])
    if (Array.isArray(legalEntity)) legalEntity = legalEntity[0]
    let companyCashflow = map[COMPANY_CASH_FLOW]
    let inputData:any = {
      enums,
      generalData: {
        [TYPE]: generalData[TYPE],
        financialRating: generalData.financialRating
      },
      commercialCredit: {
        commercialCredit: creditReport.commercialCredit
      },
      asset: {
        [TYPE]: asset[TYPE],
        usefulLife: asset.usefulLife,
        secondaryMarket: asset.secondaryMarket,
        relocationTime: asset.relocationTime,
        assetType: asset.assetType,
      },
      financialDetails,
      quote: {
        [TYPE]: quote[TYPE],
        term: quote.term,
        leaseType: asset.leaseType
      },
      legalEntity: {
        [TYPE]: legalEntity[TYPE],
        registrationDate: legalEntity.registrationDate,
        ownFacility: legalEntity.ownFacility
      },
      accountsData: accounts.map(acc => pick(acc, [TYPE, 'history', 'closedDate'])),
    }
    if (companyCashflow)
      inputData.companyCashflow = {
        extraEquipmentRatio: companyCashflow.extraEquipmentRatio
      }

    return {
      inputData,
      additionalData: {
        commercialCredit,
        generalData,
        legalEntity,
      }
    }
  }
  public calcForCompany(params) {
    const { asset, legalEntity, companyCashflow, financialDetails, accountsData, quote, generalData, enums } = params
    let financialRating = generalData  &&  generalData.financialRating
    let ratingInBureau = 0
    if (financialRating) {
      let s = financialRating.slice(-2)
      if (s === 'A1' || s === 'A2' || s === 'B1' || s === 'B2' || s === 'NC' || s === 'EX')
        ratingInBureau = 2
    }
    else
      ratingInBureau = 2
    let recentAccounts = this.calcAccountsForCompany(accountsData)
    let {recentMonthsInArrears, percentageOfGoodAccounts, worstMopThisYear, recentClosedAccounts, recentOpenedAccounts} = recentAccounts
    let yearsInOperation = 0, ownFacility = 0
    if (legalEntity) {
      if ((Date.now() - legalEntity.registrationDate) / ONE_YEAR_MILLIS > 2)
        yearsInOperation = 1

      if (legalEntity.ownFacility)
        ownFacility = 1
    }

    let companyFinancials
    let debtFactor
    let paymentScore = 0
    let characterScore = 0
    if (financialDetails) {
      companyFinancials = this.calcCompanyFinancials(financialDetails)

      debtFactor = companyCashflow && companyCashflow.extraEquipmentRatio
      debtFactor = this.calcScore(debtFactor, this.conf.debtFactor)
      paymentScore = debtFactor || 0
      let exclude = {
        profitable: true
      }
      for (let p in companyFinancials) {
        if (!exclude[p])
        paymentScore += companyFinancials[p]
      }
      characterScore = companyFinancials.profitable
    }
    const {usefulLife, secondaryMarket, relocation, assetType, leaseType} = this.getCommonScores({quote, asset, enums})

    characterScore += (ratingInBureau + recentMonthsInArrears + percentageOfGoodAccounts + worstMopThisYear + recentClosedAccounts + recentOpenedAccounts + yearsInOperation + ownFacility)
    let assetScore = usefulLife + secondaryMarket + relocation + assetType
    let totalScore = characterScore + paymentScore + assetScore
    let props:any = {
      ratingInBureau,
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
      totalScore,
      ...recentAccounts
    }
    if (companyFinancials) {
      props = {...props, ...companyFinancials}
      props.debtFactor = debtFactor
    }
    props = sanitize(props).sanitized

    return props
  }
  public createCompanyScoreDetails(props:any, data) {
    const { map, asset, legalEntity, quote, generalData } = data
    let scoreDetails = []
    this.addToScoreDetails({scoreDetails, form: generalData, formProperty: 'financialRating', property: 'ratingInBureau', score: props.ratingInBureau, group: CHARACTER_GROUP});

    let { maxScores } = this.conf
    this.addToScoreDetails({scoreDetails, form: generalData, formProperty: 'accounts', property: 'recentMonthsInArrears', score: props.recentMonthsInArrears, group: CHARACTER_GROUP});
    this.addToScoreDetails({scoreDetails, form: generalData, formProperty: 'accounts', property: 'percentageOfGoodAccounts', score: props.percentageOfGoodAccounts, group: CHARACTER_GROUP});
    this.addToScoreDetails({scoreDetails, form: generalData, formProperty: 'accounts', property: 'worstMopThisYear', score: props.worstMopThisYear, group: CHARACTER_GROUP});
    this.addToScoreDetails({scoreDetails, form: generalData, formProperty: 'accounts', property: 'recentOpenedAccounts', score: props.recentOpenedAccounts, group: CHARACTER_GROUP});
    this.addToScoreDetails({scoreDetails, form: generalData, formProperty: 'accounts', property: 'recentClosedAccounts', score: props.recentClosedAccounts, group: CHARACTER_GROUP});

    this.addToScoreDetails({scoreDetails, form: legalEntity, formProperty: 'registrationDate', property: 'yearsInOperation', score: props.yearsInOperation, group: CHARACTER_GROUP});
    this.addToScoreDetails({scoreDetails, form: legalEntity, formProperty: 'ownFacility', property: 'ownFacility', score: props.ownFacility, group: CHARACTER_GROUP});

    this.addToScoreDetails({scoreDetails, form: asset, property: 'characterScore', score: props.characterScore, group: CHARACTER_GROUP, total: true, maxScores});
    this.addToScoreDetails({scoreDetails, form: asset, property: 'assetScore', score: props.assetScore, group: ASSET_GROUP, total: true, maxScores});

    this.addToScoreDetails({scoreDetails, property: 'totalScore', score: props.totalScore, total: true});
    this.addToScoreDetails({scoreDetails, form: asset, formProperty: 'usefulLife', property: 'usefulLife', score: props.usefulLife, group: ASSET_GROUP});

    this.addToScoreDetails({scoreDetails, form: asset, formProperty: 'secondaryMarket', property: 'secondaryMarket', score: props.secondaryMarket, group: ASSET_GROUP});

    this.addToScoreDetails({scoreDetails, form: asset, formProperty: 'relocation', property: 'relocation', score: props.relocation, group: ASSET_GROUP});

    this.addToScoreDetails({scoreDetails, form: asset, formProperty: 'assetType', property: 'assetType', score: props.assetType, group: ASSET_GROUP});
    if (props.leaseType) {
      this.addToScoreDetails({scoreDetails, form: quote, formProperty: 'leaseType', property: 'leaseType', score: props.leaseType, group: ASSET_GROUP});
    }
    this.addToScoreDetails({scoreDetails, form: map[COMPANY_CASH_FLOW], property: 'debtFactor', formProperty: 'extraEquipmentRatio', score: props.debtFactor, group: PAYMENT_GROUP});
    let financialDetails = map[COMPANY_FINANCIALS]
    if (financialDetails) {
      this.addToScoreDetails({scoreDetails, form: financialDetails, property: 'paymentScore', score: props.paymentScore, group: PAYMENT_GROUP, total: true, maxScores});
      this.addToScoreDetails({scoreDetails, form: financialDetails, property: 'profitable', formProperty: 'netProfitP', score: props.profitable, group: CHARACTER_GROUP});
      this.addToScoreDetails({scoreDetails, form: financialDetails, property: 'liquidity', formProperty: 'acidTest', score: props.liquidity, group: PAYMENT_GROUP});
      this.addToScoreDetails({scoreDetails, form: financialDetails, property: 'leverage', formProperty: 'leverage', score: props.leverage, group: PAYMENT_GROUP});
      this.addToScoreDetails({scoreDetails, form: financialDetails, property: 'technicalBankrupcy', formProperty: 'technicalBankrupcy', score: props.technicalBankrupcy, group: PAYMENT_GROUP});
      this.addToScoreDetails({scoreDetails, form: financialDetails, property: 'workingCapitalRatio', formProperty: 'workingCapitalRatio', score: props.workingCapitalRatio, group: PAYMENT_GROUP});
      this.addToScoreDetails({scoreDetails, form: financialDetails, property: 'debtLevel', formProperty: 'indebtedness', score: props.debtLevel, group: PAYMENT_GROUP});
      this.addToScoreDetails({scoreDetails, form: financialDetails, property: 'returnOnAssets', formProperty: 'returnOnAssets', score: props.returnOnAssets, group: PAYMENT_GROUP});
      this.addToScoreDetails({scoreDetails, form: financialDetails, property: 'operatingIncomeMargin', formProperty: 'operatingIncomeMargin', score: props.operatingIncomeMargin, group: PAYMENT_GROUP});
      this.addToScoreDetails({scoreDetails, form: financialDetails, property: 'returnOnEquity', formProperty: 'returnOnEquity', score: props.returnOnEquity, group: PAYMENT_GROUP});
      this.addToScoreDetails({scoreDetails, form: financialDetails, property: 'netProfit', formProperty: 'netProfitP', score: props.netProfit, group: PAYMENT_GROUP});
    }
    return scoreDetails
  }
  public createIndividualScoreDetails(props:any, data) {
    const { map, cbReport, cCheck, asset, quote } = data
    let scoreDetails = []
    this.addToScoreDetails({scoreDetails, form: map[APPLICANT_INFORMATION], formProperty: 'existingCustomerRating', property: 'existingCustomer', score: props.existingCustomer, group: CHARACTER_GROUP});

    if (props.yearsAtWork) {
      this.addToScoreDetails({scoreDetails, form: map[APPLICANT_MED_PROFESSION], formProperty: 'yearsAtWork', property: 'yearsAtWork', score: props.yearsAtWork, group: CHARACTER_GROUP});
    }
    if (props.yearsAtResidence) {
      this.addToScoreDetails({scoreDetails, form: map[APPLICANT_ADDRESS], formProperty: 'yearsAtResidence', property: 'yearsAtResidence', score: props.yearsAtResidence, group: CHARACTER_GROUP});
    }
    this.addToScoreDetails({scoreDetails, form: cbReport && cbReport.creditScore, formProperty: 'scoreValue', property: 'creditBureauScore', score: props.creditBureauScore, group: CHARACTER_GROUP});

    if (props.specialityCouncil) {
      this.addToScoreDetails({scoreDetails, form: cCheck, formProperty: 'status', property: 'specialityCouncil', score: props.specialityCouncil, group: CHARACTER_GROUP});
    }
    let { maxScores } = this.conf
    this.addToScoreDetails({scoreDetails, property: 'characterScore', score: props.characterScore, group: CHARACTER_GROUP, total: true, maxScores});

    this.addToScoreDetails({scoreDetails, form: asset, property: 'assetScore', score: props.assetScore, group: ASSET_GROUP, total: true, maxScores});
    this.addToScoreDetails({scoreDetails, property: 'totalScore', score: props.totalScore, total: true});
    this.addToScoreDetails({scoreDetails, form: asset, formProperty: 'usefulLife', property: 'usefulLife', score: props.usefulLife, group: ASSET_GROUP});

    this.addToScoreDetails({scoreDetails, form: asset, formProperty: 'secondaryMarket', property: 'secondaryMarket', score: props.secondaryMarket, group: ASSET_GROUP});

    this.addToScoreDetails({scoreDetails, form: asset, formProperty: 'relocation', property: 'relocation', score: props.relocation, group: ASSET_GROUP});

    this.addToScoreDetails({scoreDetails, form: asset, formProperty: 'assetType', property: 'assetType', score: props.assetType, group: ASSET_GROUP});
    if (props.leaseType) {
      this.addToScoreDetails({scoreDetails, form: quote, formProperty: 'leaseType', property: 'leaseType', score: props.leaseType, group: ASSET_GROUP});
    }
    if (props.capacityToPay) {
      this.addToScoreDetails({scoreDetails, form: map[CASH_FLOW], formProperty: 'capacityToPayFactor', property: 'capacityToPay', score: props.capacityToPay, group: PAYMENT_GROUP});
      this.addToScoreDetails({scoreDetails, form: map[CASH_FLOW], formProperty: 'capacityToPayFactor', property: 'paymentScore', score: props.capacityToPay, group: PAYMENT_GROUP, total: true, maxScores});
    }
    return scoreDetails
  }

  private calcAccountsForCompany(accounts) {
    if (!accounts) return {}
    let score = 2
    let goodAccounts = 0
    let worstMopThisYear = 0
    let last12monthsScore = 2 // score only for the last 12 months
    let closedAccounts = []
    let openedAccounts = []
    for (let i=0; i<accounts.length; i++) {
      let acc = accounts[i]
      const { history, closedDate } = acc
      if (!history) continue
      if (closedDate) {
        closedAccounts.push(acc)
        continue
      }
      openedAccounts.push(acc)
      if (!match4(history))
      // if (hasDigitsBigerThan(history, 4))
        score = 0
      else if (history.indexOf('4') !== -1)
        score = score < 2 ? score : 1
      else
        goodAccounts++
      let history12 = history.length > 12 ? history.slice(0, 12) : history
      if (!match4(history))
        last12monthsScore = 0
      else if (history12.indexOf('4') !== -1)
        last12monthsScore = last12monthsScore < 2 ? last12monthsScore : 1
    }
    let recentMonthsInArrears = score

    let percentageOfGoodAccounts = goodAccounts * 100/openedAccounts.length
    percentageOfGoodAccounts  = percentageOfGoodAccounts > 80 ? 2 : 0

    worstMopThisYear = last12monthsScore
    let {count: openCnt, accScores: openAccScores} = this.calcRecentCompanyAccounts(openedAccounts)
    let {count: closeCnt, accScores: closeAccScores} = this.calcRecentCompanyAccounts(closedAccounts)
    let coef = Math.round(12/(openCnt + closeCnt) * 100)/100

    let openedAccScoresSum = openAccScores && openAccScores.length ? openAccScores.map(acc => acc.percent).reduce((a, b) => a + b, 0) : 0
    let closedAccScoresSum = closeAccScores && closeAccScores.length ? closeAccScores.map(acc => acc.percent).reduce((a, b) => a + b, 0) : 0

    let recentOpenedAccounts = coef * openedAccScoresSum / 100
    let recentClosedAccounts = coef * closedAccScoresSum / 100
    return { recentOpenedAccounts, recentClosedAccounts, worstMopThisYear, percentageOfGoodAccounts, recentMonthsInArrears }
  }

  calcCompanyFinancials(fDetail) {
    if (!fDetail)
      return {}

    let profitable = fDetail.netProfitP || 0
    let liquidity = fDetail.acidTest || 0
    let leverage = fDetail.leverage || 0
    let technicalBankrupcy = fDetail.technicalBankrupcy || 0
    let workingCapitalRatio = fDetail.workingCapitalRatio || 0
    let debtLevel = fDetail.indebtedness || 0
    let returnOnEquity = fDetail.returnOnEquity || 0
    let returnOnAssets = fDetail.returnOnAssets || 0
    let operatingIncomeMargin = fDetail.operatingProfitP || 0
    let netProfit = fDetail.netProfitP || 0

    profitable = profitable  ? 2 : 0
    liquidity = liquidity > 1 ? 2 : 0

    if (leverage <= 60) leverage = 2
    else if (leverage < 71) leverage = 1
    else leverage = 0

    technicalBankrupcy = technicalBankrupcy < 33 ? 2 : 0

    if (workingCapitalRatio >= 2) workingCapitalRatio = 2
    else if (workingCapitalRatio < 2  &&  workingCapitalRatio > 1) workingCapitalRatio = 1
    else workingCapitalRatio = 0

    if (debtLevel < 60)
      debtLevel = 2
    else if (debtLevel >= 60  &&  debtLevel < 70)
      debtLevel = 1
    else
      debtLevel = 0

    if (returnOnAssets >= 8)
      returnOnAssets = 2
    else if (returnOnAssets >= 2  &&  returnOnAssets < 8)
      returnOnAssets = 1
    else
      returnOnAssets = 0

    if (operatingIncomeMargin > 5)
      operatingIncomeMargin = 2
    else if (operatingIncomeMargin >= 3 && operatingIncomeMargin <= 5)
      operatingIncomeMargin = 1
    else
      operatingIncomeMargin = 0

    if (returnOnEquity >= 10)
      returnOnEquity = 2
    else if (returnOnEquity >= 2  &&  returnOnEquity < 10)
      returnOnEquity = 1
    else
      returnOnEquity = 0

    if (netProfit > 10) netProfit = 2
    else if (netProfit < 10  &&  netProfit > 1) netProfit = 1
    else netProfit = 0

    return {
      profitable,
      liquidity,
      leverage,
      technicalBankrupcy,
      workingCapitalRatio,
      debtLevel,
      returnOnEquity,
      returnOnAssets,
      operatingIncomeMargin,
      netProfit,
    }
  }
  private async credentialsCheckPass(application, parent) {
    const { checks, checksOverride } = application
    let parentChecks, parentChecksOverride
    if (parent)
      ({ parentChecks, parentChecksOverride } = parent)
    if (!checks  &&  !parentChecks) return {}
    let allChecks, allCheckOverrides
    if (!checks) {
      allChecks = parentChecks
      allCheckOverrides = parentChecksOverride
    }
    else {
      allChecks = checks
      if (parentChecks) {
        allChecks = [...checks, ...parentChecks]
        if (checksOverride) {
          if (!parentChecksOverride)
            allCheckOverrides = checksOverride
          else
            allCheckOverrides = [...checksOverride, parentChecksOverride]
        }
        else
          allCheckOverrides = parentChecksOverride
      }
    }

    let credsChecks = allChecks.find(check => check[TYPE] === CREDS_CHECK)
    if (!credsChecks || !credsChecks.length)
      return {}
    let cChecks:any = await Promise.all(credsChecks.map(c => this.bot.getResource(c)))
    cChecks.sort((a, b) => b._time - a._time)
    let credsCheck = await this.bot.getResource(credsChecks[0])
    if (allCheckOverrides)  {
      let credsCheckOverride = allCheckOverrides.find(co => co[TYPE] === CREDS_CHECK_OVERRIDE)
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

  private calcAccounts(accounts) {
    let sumProps = ['totalMop2', 'totalMop3', 'totalMop4', 'totalMop5']
    let data = accounts.map(acc => {
      let sum = 0
      sumProps.forEach((p, i) => {
        let v = acc[p]
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
    let goodOpen = 0, goodClose = 0,
        avgOpen = 0, avgClose = 0,
        badOpen = 0, badClose = 0,
        openedAccounts = [], closedAccounts = []
    data.forEach(account => {
      const {accountClosingDate, sum} = account
      if (accountClosingDate) {
        closedAccounts.push(account)
        if (sum < 4) goodClose++
        else if (sum === 4) avgClose++
        else badClose++
      }
      else {
        openedAccounts.push(account)
        if (sum < 4) goodOpen++
        else if (sum === 4) avgOpen++
        else badOpen++
      }
    })
    let open = openedAccounts.length
    let close = closedAccounts.length
    // high=16, average=8, low=4
    const { accountsScore } = this.conf
    const { high, average, low } = accountsScore
    let accScore
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

      accScore = Math.round(points)
    }
    else if (open) {
      if (goodOpen) return high
      if (avgOpen) return average
      accScore =  low
    }
    else if (close) {
      if (goodClose) return high
      if (avgClose) return average
      accScore =  low
    }
    return { accScore }
  }
  private calcRecentCompanyAccounts(accounts) {
    let recentAccountsMax3 = 0
    let cnt = accounts.length
    if (!cnt) return {}

    cnt = Math.min(cnt, 3)
    let accScores = []
    for (let i=0; i<cnt; i++) {
      let { history } = accounts[i]
      if (!match3(history)) {
        accScores.push({
          percent: 0,
          score:  0,
        })
        recentAccountsMax3++
        continue
      }
      let good = history.indexOf('3') === -1
      accScores.push({
        percent: good ? 100 : 50,
        score:  good ? 2 : 1,
      })

      recentAccountsMax3++
    }
    return {count: recentAccountsMax3, accScores}
  }
  private calcScore(value, scoreConf) {
    if (!scoreConf) return 0
    for (let p in scoreConf) {
      let val = scoreConf[value]

      if (val)
        return val
      if (p.charAt(0) === '>') {
        if (p.charAt(1) === '=') {
          if (value >= parseInt(p.slice(2)))
          return scoreConf[p]
        }
        else if (value > parseInt(p.slice(1)))
          return scoreConf[p]
      }
      if (p.charAt(0) === '<') {
        if (p.charAt(1) === '=') {
          if (value <= parseInt(p.slice(2)))
          return scoreConf[p]
        }
        else if (value < parseInt(p.slice(1)))
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
export const createPlugin: CreatePlugin<void> = ({ bot, applications, productsAPI }, { conf, logger }) => {
  const scoringReport = new ScoringReport({bot, applications, conf, logger, productsAPI})
  const plugin: IPluginLifecycleMethods = {
    async genCreditScore(application, conf) {
      if (!application || !conf) return
      let { checks, forms, parentFormsStubs } = application
      let app
      if (!checks && !forms)
        app = await bot.getResource(application, {backlinks: ['checks', 'forms']})

      else app = application
      logger.debug('creditScoreReport is called for pending CB check')
      await scoringReport.runReport({application, parentFormsStubs, conf})
    },
    onFormsCollected: async ({ req }: { req: IPBReq }) => {
      let { application, parentFormsStubs } = req

      // if (!application || application.draft) return
      if (!application) return
      logger.debug('creditScoreReport is called onFormsCollected')
      const requestFor = application.requestFor
      let { products } = conf
      if (!products || !products[requestFor]) return

      await scoringReport.runReport({application, parentFormsStubs, conf})
    },
    async onmessage(req: IPBReq) {
      let { application, payload, parentFormsStubs } = req
      if (payload[TYPE] !== DATA_BUNDLE_SUMBITTED) return
      logger.debug('creditScoreReport is called onmessage')
      debugger
      await scoringReport.runReport({application, parentFormsStubs, conf})
    },
    // async didApproveApplication({ req }) {
    //   const { application, parentFormsStubs } = req
    //   if (!application || !application.parent) return

    //   const requestFor = application.requestFor
    //   let { products } = conf
    //   if (!products || !products[requestFor]) return
    //   let inputData = await scoringReport.runReport({application, conf, parentFormsStubs, dataOnly: true})

    //   // send transaction on blockchain
    //   // if (inputData.isCompany)
    //   //   props = this.calcForCompany(inputData)
    //   // else
    //   //   props = this.calcForIndividual(inputData)

    // }
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
function match3(history) {
  return history.replace(/[^0-9 ]/g, '').match(/^[0-3]+$/)
}
function match4(history) {
  return history.replace(/[^0-9 ]/g, '').match(/^[0-4]+$/)
}
