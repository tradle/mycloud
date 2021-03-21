import cloneDeep from 'lodash/cloneDeep'
import size from 'lodash/size'
import extend from 'lodash/extend'

import { 
  CreatePlugin, 
  IPBReq, 
  Bot,
  Logger,
  Applications,
  IPluginLifecycleMethods, 
  ValidatePluginConf } from '../types'
import { TYPE } from '@tradle/constants'
import validateResource from '@tradle/validate-resource'
import { getLatestForms } from '../utils'
import { AnyLengthString } from 'aws-sdk/clients/comprehend'
// @ts-ignore
const { sanitize } = validateResource.utils
const QUOTATION = 'quotation'
const AMORTIZATION = 'amortization'
interface AmortizationItem {
  period: number,
  principal: {
    value: number,
    currency: string
  },
  payment: {
    value: number,
    currency: string
  },
  interest: {
    value: number,
    currency: string
  },
  principalPayment?: {
    value: number,
    currency: string
  }
}
class LeasingQuotesAPI {
  private bot: Bot
  private logger: Logger
  private applications: Applications
  private conf: any
  constructor({ bot, conf, applications, logger }) {
    this.bot = bot
    this.applications = applications
    this.logger = logger
    this.conf = conf
  }
  public async quotationPerTerm(application, formRequest) {
    const stubs = getLatestForms(application)
    let qiStub = stubs.find(({ type }) => type.endsWith('QuotationInformation'))
    if (!qiStub) return
    const quotationInfo = await this.bot.getResource(qiStub)
    let { 
      factor, 
      netPrice,
      assetName,
      quotationConfiguration,
      exchangeRate,
      depositPercentage,
      deliveryTime,
      netPriceMx,
      vat,
      priceMx,
      depositValue,
      annualInsurance,
      fundedInsurance
    } = quotationInfo
    
    if (!factor || !netPrice || !quotationConfiguration || !exchangeRate || !depositPercentage || !deliveryTime || 
        !netPriceMx || !priceMx || !depositValue || !fundedInsurance) {
      this.logger.debug('quotation: Some numbers are missing')
      return {}
    }
      
    let configuration = await this.bot.getResource(quotationConfiguration)
    if (!configuration) return
    let configurationItems = configuration.items
    // let { quotationConfiguration } = conf
    // if (!quotationConfiguration) {
      // try {
      //   let qc = await bot.db.findOne({
      //     filter: {
      //       EQ: {
      //         [TYPE]: QUOTATION_CONFIGURATION,
      //         configuration: quotationConfiguration
      //       }
      //     }
      //   })
      //   configurationItems = qc.items
      // } catch (err) {
      //   return
      // }
    // }

    let quotationDetails = []
    let defaultQC = configurationItems[0]
    let ftype = formRequest.form
    configurationItems.forEach(quotConf => {
      let qc = cloneDeep(defaultQC)
      for (let p in quotConf)
        qc[p] = quotConf[p]
      let {
        term,
        // dt1,
        // dt2,
        // dt3,
        // dt4,
        residualValue,
        vatRate,
        commissionFee,
        factorVPdelVR,
        minIRR,
        lowDeposit,
        lowDepositPercent
      } = qc
      let termVal = term.title.split(' ')[0]
      let factorPercentage = mathRound(factor / 100 / 12 * termVal, 4)

      let dtID = deliveryTime.id.split('_')[1] 
      let deliveryTermPercentage = qc[dtID]
      let depositFactor = 0
      let lowDepositFactor
      if (depositPercentage > lowDeposit * 100)
        lowDepositFactor = 0
      else
        lowDepositFactor = lowDepositPercent
      let totalPercentage = mathRound(1 + factorPercentage + deliveryTermPercentage + depositFactor + lowDepositFactor, 4)

      let monthlyPayment = (priceMx.value - depositValue.value - (residualValue * priceMx.value/100)/(1 + factorVPdelVR))/(1 + vatRate) * totalPercentage/termVal

      let insurance = fundedInsurance.value
      let initialPayment = depositPercentage === 0 && monthlyPayment + insurance || depositValue.value / (1 + vatRate)
      let commissionFeeCalculated = commissionFee * priceMx.value
      let initialPaymentVat = (initialPayment + commissionFeeCalculated) * vatRate
      let currency = netPriceMx.currency
      let vatQc =  mathRound((monthlyPayment + insurance) * vatRate)
      let qd:any = {
        [TYPE]: ftype,
        factorPercentage,
        deliveryTermPercentage,
        // depositFactor:
        lowDepositFactor: depositPercentage > lowDeposit && 0 || lowDepositPercent,
        term,
        commissionFee: commissionFeeCalculated  &&  {
          value: mathRound(commissionFeeCalculated),
          currency
        },
        initialPayment: initialPayment && {
          value: mathRound(initialPayment),
          currency
        },
        initialPaymentVat: initialPaymentVat && {
          value: mathRound(initialPaymentVat),
          currency
        },
        totalPercentage,
        totalInitialPayment: initialPayment && {
          value: mathRound(commissionFeeCalculated + initialPayment + initialPaymentVat),
          currency
        },
        monthlyPayment: monthlyPayment  &&  {
          value: mathRound(monthlyPayment),
          currency
        },
        monthlyInsurance: fundedInsurance,
        vat: monthlyPayment && {
          value: vatQc,
          currency
        }, 
        totalPayment: monthlyPayment && {
          value: mathRound(monthlyPayment + insurance + vatQc),
          currency
        },
        purchaseOptionPrice: priceMx && {
          value: mathRound(priceMx.value * residualValue/100),
          currency
        }
      }
      qd = sanitize(qd).sanitized
      quotationDetails.push(qd)
    })
    return {
      type: ftype,
      terms: quotationDetails
    }
  }
  public async amortizationPerMonth(application, formRequest) {
    const stubs = getLatestForms(application)
    let qiStub = stubs.find(({ type }) => type.endsWith('QuotationInformation'))
    if (!qiStub) return
    let qdStub = stubs.find(({ type }) => type.endsWith('QuotationDetails'))
    if (!qdStub) return
    const quotationInfo = await this.bot.getResource(qiStub)
    const {
      netPriceMx
    } = quotationInfo
    const quotationDetail = await this.bot.getResource(qdStub)

    const {
      monthlyPayment,
      term
    } = quotationDetail
    if (!netPriceMx || !term || !monthlyPayment) {
      this.logger.debug('amortization: Some numbers are missing')
      return {}
    }  
    let termVal = term.title.split(' ')[0]
    let payment = monthlyPayment.value

    let leseeImplicitRate = RATE(termVal, monthlyPayment, -netPriceMx.value) * 12 // * 100

    let ftype = formRequest.form
    let itemType = ftype + 'Item'
    let {value: principal, currency } = netPriceMx
    let items = []
    for (let i=0; i<termVal; i++) {
      let item:AmortizationItem = {
        [TYPE]: itemType,
        period: i + 1,
        principal: {
          value: mathRound(principal),
          currency
        },
        payment: { 
          value: payment,
          currency
        },
        interest: {
          value: mathRound(principal * leseeImplicitRate / 12),        
          currency
        }
      }
      item.principalPayment = {
        value: mathRound(payment - item.interest.value),
        currency
      }
      items.push(item)
      principal -= item.principalPayment.value
    }
    return {
      [TYPE]: ftype,
      term,
      items
    }
  }
}
export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const leasingQuotes = new LeasingQuotesAPI({ bot, conf, applications, logger })
  const plugin: IPluginLifecycleMethods = {
    async willRequestForm({ application, formRequest }) {
      if (!application) return

      const requestFor = application.requestFor

      let productConf = conf[requestFor]

      if (!productConf) return

      let ftype = formRequest.form
      let action = productConf[ftype] 
      if (!action) return

      let model = bot.models[ftype]
      if (!model) return

      let prefill = {}
      if (action === QUOTATION) 
        prefill = await leasingQuotes.quotationPerTerm(application, formRequest)      
      else if (action === AMORTIZATION) 
        prefill = await leasingQuotes.amortizationPerMonth(application, formRequest)
      
      if (!size(prefill)) return
      if (!formRequest.prefill) {
        formRequest.prefill = {
          [TYPE]: ftype
        }
      }
      extend(formRequest.prefill, prefill)
    }
  }
  return {
    plugin
  }
}
function mathRound(val: number, digits?:number) {
  if (!digits)
    digits = 2
  let pow = Math.pow(10, digits)  
  return Math.round(val * pow)/pow
}
/*!
 * @fileOverview Finance Excel Rate Formula Javascript Equivalent
 * @version 1.0.0
 *
 * @author Burak Arslan @kucukharf http://www.github.com/kucukharf
 * @license
 * Copyright (c) 2010-2018 Burak Arslan
 * Licensed under Creative Commons (CC) license
 * @usage RATE($periods, $payment, $present, $future, $type, $guess)
 */

function RATE (periods, payment, present, future?:number, type?:number, guess?:number) {
  guess = (guess === undefined) ? 0.01 : guess;
  future = (future === undefined) ? 0 : future;
  type = (type === undefined) ? 0 : type;

  // Set maximum epsilon for end of iteration
  var epsMax = 1e-10;

  // Set maximum number of iterations
  var iterMax = 10;

  // Implement Newton's method
  var y, y0, y1, x0, x1 = 0,
    f = 0,
    i = 0;
  var rate = guess;
  if (Math.abs(rate) < epsMax) {
    y = present * (1 + periods * rate) + payment * (1 + rate * type) * periods + future;
  } else {
    f = Math.exp(periods * Math.log(1 + rate));
    y = present * f + payment * (1 / rate + type) * (f - 1) + future;
  }
  y0 = present + payment * periods + future;
  y1 = present * f + payment * (1 / rate + type) * (f - 1) + future;
  i = x0 = 0;
  x1 = rate;
  while ((Math.abs(y0 - y1) > epsMax) && (i < iterMax)) {
    rate = (y1 * x0 - y0 * x1) / (y1 - y0);
    x0 = x1;
    x1 = rate;
      if (Math.abs(rate) < epsMax) {
        y = present * (1 + periods * rate) + payment * (1 + rate * type) * periods + future;
      } else {
        f = Math.exp(periods * Math.log(1 + rate));
        y = present * f + payment * (1 / rate + type) * (f - 1) + future;
      }
    y0 = y1;
    y1 = y;
    ++i;
  }
  return rate;
};

