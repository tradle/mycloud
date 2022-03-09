import cloneDeep from 'lodash/cloneDeep'
import size from 'lodash/size'
import extend from 'lodash/extend'
const { xirr, convertRate } = require('node-irr')
import dateformat from 'dateformat'
import {
  CreatePlugin,
  Bot,
  Logger,
  Applications,
  IPluginLifecycleMethods,
  ValidatePluginConf
} from '../types'
import { TYPE } from '@tradle/constants'
import validateResource from '@tradle/validate-resource'
import { getLatestForms } from '../utils'
// @ts-ignore
const { sanitize } = validateResource.utils
const QUOTATION = 'quotation'
const AMORTIZATION = 'amortization'
const COST_OF_CAPITAL = 'tradle.credit.CostOfCapital'

interface AmortizationItem {
  [TYPE]: string
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
  public async quotationPerTerm({application, formRequest}) {
    const stubs = getLatestForms(application)
    let qiStub = stubs.find(({ type }) => type.endsWith('QuotationInformation'))
    if (!qiStub) return

    let costOfCapital = await this.bot.db.findOne({
      filter: {
        EQ: {
          [TYPE]: COST_OF_CAPITAL,
          current: true
        }
      }
    })
    if (!costOfCapital) return
   
    const quotationInfo = await this.bot.getResource(qiStub)
    let {
      factor,
      netPrice,
      commissionFee,
      asset,
      exchangeRate,
      depositPercentage = 0,
      deliveryTime,
      netPriceMx,
      vatRate,
      priceMx,
      depositValue,
      fundedInsurance
    } = quotationInfo
 
    if (!factor || !netPrice || !exchangeRate || !deliveryTime ||
        !netPriceMx || !priceMx || !fundedInsurance) {
      this.logger.debug('quotation: Some numbers are missing')
      return {}
    }

    // let configuration = await this.bot.getResource(quotationConfiguration)
    // if (!configuration) return
    // let configurationItems = configuration.items

    let quotationDetails = []
    let ftype = formRequest.form
    const {
      deliveryFactor: configurationItems,
      minimumDeposit,
      lowDepositFactor: lowDepositPercent,
      presentValueFactor,
    } = costOfCapital
    let { residualValue } = await this.bot.getResource(asset)
    // let configurationItems = await Promise.all(deliveryFactor.map(df => this.bot.getResource(df)))
    let defaultQC = configurationItems[0]
   
    configurationItems.forEach((quotConf:any, i) => {
      let qc = cloneDeep(defaultQC)
      for (let p in quotConf)
        qc[p] = quotConf[p]
      let {
        term,
        // factor: factorVPdelVR
      } = quotConf
  
      let residualValuePerTerm = residualValue.find(rv => {
        return rv.term.id === term.id
      })
      residualValuePerTerm = residualValuePerTerm && residualValuePerTerm.rv / 100
      let termVal = term.title.split(' ')[0]
      let factorPercentage = mathRound(factor / 100 / 12 * termVal, 4)

      let dtID = deliveryTime.id.split('_')[1]
      let deliveryTermPercentage = qc[dtID] || 0
      let depositFactor = 0
      let lowDepositFactor
      if (depositPercentage < minimumDeposit)
        lowDepositFactor = termVal/12 * lowDepositPercent/100
      else
        lowDepositFactor = 0
      let totalPercentage = mathRound(1 + factorPercentage + deliveryTermPercentage + depositFactor + lowDepositFactor, 4)

      let depositVal = depositValue && depositValue.value || 0

      let factorVPdelVR = termVal/12 * presentValueFactor/100
      let monthlyPayment = (priceMx.value - depositVal - (residualValuePerTerm * priceMx.value)/(1 + factorVPdelVR))/(1 + vatRate) * totalPercentage/termVal
      // let monthlyPaymentPMT = (vatRate/12)/(((1+vatRate/12)**termVal)-1)*(netPriceMx.value*((1+vatRate/12)**termVal)-(netPriceMx.value*residualValue/100))

      let insurance = fundedInsurance.value
      let initialPayment = depositPercentage === 0 && monthlyPayment + insurance ||  depositVal / (1 + vatRate)
      let commissionFeeCalculated = commissionFee * priceMx.value
      let initialPaymentVat = (initialPayment + commissionFeeCalculated) * vatRate
      let currency = netPriceMx.currency
      let vatQc =  mathRound((monthlyPayment + insurance) * vatRate)
      let qd:any = {
        [TYPE]: ftype,
        factorPercentage,
        deliveryTermPercentage,
        // depositFactor:
        lowDepositFactor,
        term,
        commissionFee: {
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
          value: mathRound(priceMx.value * residualValuePerTerm),
          currency
        }
      }
      let payPerMonth = qd.monthlyPayment.value*(1 + vatRate)
      let initPayment = depositValue.value > 0 ? qd.totalInitialPayment.value : payPerMonth
      let d = new Date()
      let date = dateformat(d.getTime(), 'yyyy-mm-dd')

      let data = [
        {amount: -priceMx.value, date}, 
        {amount: initPayment, date}
      ]
      let m = d.getMonth()
      for (let j=0; j<termVal - 1; j++) {
        this.nextMonth(d)          
        let md = dateformat(d.getTime(), 'yyyy-mm-dd')
        data.push({amount: payPerMonth, date: md})
      }
      this.nextMonth(d)
      data.push({amount: payPerMonth + qd.purchaseOptionPrice.value, date: dateformat(d.getTime(), 'yyyy-mm-dd')})

      const {rate} = xirr(data)
      qd.xirr = Math.round(convertRate(rate, 365) * 100 * 100)/100
      
      qd = sanitize(qd).sanitized
      quotationDetails.push(qd)
    })
    return {
      type: ftype,
      terms: quotationDetails
    }
  }
  private nextMonth(date) {
    let m = date.getMonth() + 1
    if (m && m % 12 === 0) {
      m = 0
      date.setFullYear(date.getFullYear() + 1)
    }

    date.setMonth(m)
  }
  public async amortizationPerMonth({application, formRequest}) {
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

    let leseeImplicitRate = RATE(termVal, payment, -netPriceMx.value) * 12 // * 100
// if (leseeImplicitRate < 0)
//   leseeImplicitRate = -leseeImplicitRate
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
        prefill = await leasingQuotes.quotationPerTerm({application, formRequest})
      else if (action === AMORTIZATION)
        prefill = await leasingQuotes.amortizationPerMonth({application, formRequest})

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

