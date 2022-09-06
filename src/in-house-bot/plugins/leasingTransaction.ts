// plugin prepares data for 
// plugin prepares data to send to smart contract
import { pmt, pv, PaymentDueTime } from 'financial'
import {
  CreatePlugin,
  Bot,
  IPluginLifecycleMethods,
  IPBApp,
} from '../types'
import { TYPE } from '@tradle/constants'

const COST_OF_CAPITAL = 'tradle.credit.CostOfCapital'
class LeasingTransationAPI {
  private bot: Bot
  constructor({ bot }) {
    this.bot = bot
  }
  async exec({application, formType, payload}:{application: IPBApp, formType: string, payload?: any}) {
    let form
    if (payload)
      form = payload
    else {  
      let sub = application.forms.find(f => f.submission[TYPE] === formType)
      form = await this.bot.getResource(sub.submission)
    }
    let {
      term,
      factor,
      netPriceMx,
      commissionFeePercent,
      asset,
      deliveryTime,
      vatRate,
      priceMx,
      depositValue,
      fundedInsurance,
      discountFromVendor,
      loanTerm,
      loanDeposit,
      depositPercentage=0,
      blindDiscount=0,
      delayedFunding=0,
      residualValue: residualValueQuote
} = form
  
    asset = await this.bot.getResource(asset)
    
    let costOfCapital = await this.bot.db.findOne({
      filter: {
        EQ: {
          [TYPE]: COST_OF_CAPITAL,
          current: true
        }
      }
    })
  
    let {
      minimumDeposit,
      lowDepositFactor: lowDepositPercent,
      presentValueFactor,
      monthlyRateLease=0,
      monthlyRateLoan=0,
      // xirrIncrement = 0,
      // maxDeposit = 50,
      // minXIRR
    } = costOfCapital
    let vendor, xirrAdjustment, minFactor
    if (asset.vendor) {
      vendor = await this.bot.getResource(asset.vendor)
      if (vendor  && (!factor ||  factor < vendor.minFactor)) 
        factor = vendor.minFactor      
      if (vendor)
        ({xirrAdjustment, minFactor} = vendor)
    }
    // const { listPrice, maxBlindDiscount, allowLoan, residualValue, xirrAdjustmentPerTerm } = asset
    const { residualValue } = asset
    let residualValuePerTerm = residualValue && residualValue.find(rv => {
      return rv.term.id === term.id
    })
  
    if (!residualValuePerTerm)
      residualValuePerTerm = {rv: 0}
    if (residualValueQuote == null) {
      form.residualValue = residualValuePerTerm.rv
      residualValuePerTerm = residualValuePerTerm.rv
    }
    else if (residualValueQuote < residualValuePerTerm.rv)
      residualValuePerTerm = residualValueQuote
    else
      residualValuePerTerm = residualValuePerTerm.rv
  
    residualValuePerTerm /= 100
    monthlyRateLease /= 100
    monthlyRateLoan /= 100
    const { models } = this.bot
    let termProp = models[form[TYPE]].properties.term
    
    let loan, lease, leaseNew
    if (loanTerm) {
      loan = this.calcLoan({
        quote: {
          term: loanTerm,
          vatRate,
          priceMx,
          blindDiscount,
          commissionFeePercent,
          loanDeposit,
        },
        asset: {
          residualValuePerTerm,
        },
        costOfCapital: {
          monthlyRateLoan,
        }
      })
    }
    else {
      let params = {
        quote: {
          term,
          factor,
          commissionFeePercent,
          depositPercentage,
          deliveryTime,
          vatRate,
          priceMx,
          netPriceMx,
          depositValue,
          fundedInsurance,
          discountFromVendor,
          blindDiscount,
          delayedFunding,
        },
        asset: {
          residualValuePerTerm,
        },
        costOfCapital: {
          minimumDeposit,
          lowDepositPercent,
          presentValueFactor,
          monthlyRateLease,
        }                  
      }
      lease = this.calcLease(params)
      leaseNew = this.calcLeaseNew(params)
    }

    return {lease, loan}
  }
  
  calcLease({quote, asset, costOfCapital}) {
    let {
      term,
      factor,
      commissionFeePercent,
      depositPercentage,
      deliveryTime,
      vatRate,
      priceMx,
      netPriceMx,
      depositValue,
      fundedInsurance,
      discountFromVendor,
      blindDiscount,
      delayedFunding,
      // residualValueQuote,
      // termEnum
    } = quote
    let {
      // listPrice,
      // maxBlindDiscount,
      residualValuePerTerm,
    } = asset
    let {
      // from CostOfCapital
      minimumDeposit,
      lowDepositPercent,
      presentValueFactor,
      monthlyRateLease,
      // maxDeposit,
      // minXIRR,
    } = costOfCapital
  
    let depositVal = depositValue && depositValue.value || 0
  
    // let termQuoteVal = term.title.split(' ')[0]
    let currency = netPriceMx.currency
  
    let termVal = term.title.split(' ')[0]
    let factorPercentage = mathRound(factor / 100 / 12 * termVal, 4)
  
    let dtID = deliveryTime.id.split('_')[1]
  
    let deliveryTermPercentage = quote[dtID] || 0
    let depositFactor = 0
    let lowDepositFactor
    if (depositPercentage < minimumDeposit)
      lowDepositFactor = termVal/12 * lowDepositPercent/100
    else
      lowDepositFactor = 0
    let totalPercentage = mathRound(1 + factorPercentage + deliveryTermPercentage + depositFactor + lowDepositFactor, 4)
  
    let factorVPdelVR = termVal/12 * presentValueFactor/100
  
    let blindDiscountVal = blindDiscount/100
  
    let monthlyPayment = (priceMx.value - depositVal * (1 + blindDiscountVal) - (residualValuePerTerm * priceMx.value)/(1 + factorVPdelVR))/(1 + vatRate) * totalPercentage/termVal * (1 - blindDiscountVal)
  
    let insurance = fundedInsurance.value
    let initialPayment = (depositPercentage === 0 ? monthlyPayment + insurance : depositVal) / (1 + vatRate)
  
    let commissionFeeCalculated = priceMx.value * commissionFeePercent / 100
    let initialPaymentVat = (initialPayment + commissionFeeCalculated) * vatRate
  
    let vatQc =  mathRound((monthlyPayment + insurance) * vatRate)
    let paymentFromVendor = (priceMx.value - depositVal) * discountFromVendor / 100
  
    let deposit = depositPercentage/100
    let termInt = parseInt(termVal)
  
    let qd:any = {
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
      // monthlyInsurance: fundedInsurance,
      vatPerTerm: monthlyPayment && {
        value: vatQc,
        currency
      },
      totalPayment: monthlyPayment && {
        value: mathRound(monthlyPayment + insurance + vatQc),
        currency
      },
      purchaseOptionPrice: priceMx && {
        value: residualValuePerTerm ? mathRound(priceMx.value * residualValuePerTerm) : 1,
        currency
      },
      paymentFromVendor: paymentFromVendor && {
        value: mathRound(paymentFromVendor),
        currency
      }
    }
    let totalPaymentLessInsuranceAndCommission = (qd.totalInitialPayment.value - qd.commissionFee.value * (1+vatRate))+(monthlyPayment*(1+vatRate)*termVal) + qd.purchaseOptionPrice.value
    if (totalPaymentLessInsuranceAndCommission) {
      qd.totalPaymentLessInsuranceAndCommission = {
        value: mathRound(totalPaymentLessInsuranceAndCommission),
        currency
      }
    }
    let delayedFundingVal = delayedFunding && parseInt(delayedFunding.id.split('_df')[1]) || 0
  
    let deliveryTimeLease = dtID.split('dt')[1] - 1
  
    let monthlyPaymentLease = pmt(monthlyRateLease, termInt, -priceMx.value / Math.pow((1 - monthlyRateLease), (deliveryTimeLease - delayedFundingVal)) * (1 - (deposit + blindDiscountVal)), residualValuePerTerm * priceMx.value, PaymentDueTime.End)
    if (monthlyPaymentLease && monthlyPaymentLease !== Infinity) {
      qd.monthlyPaymentLease = {
        value: mathRound(monthlyPaymentLease),
        currency
      }
    }
    // XIRR & IRR
    // let payPerMonth = qd.monthlyPayment.value * (1 + vatRate)
    // let initPayment = depositValue && depositValue.value > 0 ? qd.totalInitialPayment.value : payPerMonth
    let blindPayment = priceMx.value * blindDiscountVal
    if (blindPayment) {
      qd.blindPayment = {
        value: blindPayment,
        currency
      }
    }
    return qd
  }
  calcLeaseNew({quote, asset, costOfCapital}) {
    let {
      term,
      deliveryTime,
      vatRate,
      priceMx,
      depositPercentage,
      discountFromVendor,
      blindDiscount,
      depositValue,
      delayedFunding,
      fundedInsurance,
      commissionFeePercent,
    } = quote
    let {
      residualValuePerTerm,
    } = asset
    let {
      // from CostOfCapital
      monthlyRateLease,
    } = costOfCapital
  
    let termVal = parseInt(term.title.split(' ')[0])
  
    let blindDiscountVal = blindDiscount/100
  
    let deposit = depositPercentage/100
  
    let dtID = deliveryTime.id.split('_')[1]
    let deliveryTimeVal = dtID.split('dt')[1] - 1
  
    let commissionFeeCalculated = priceMx.value * commissionFeePercent / 100
    let delayedFundingVal = delayedFunding && parseInt(delayedFunding.id.split('_df')[1]) || 0
    let termIRR = termVal + deliveryTimeVal
  
    let monthlyPayment = pmt(monthlyRateLease, termVal, -priceMx.value / Math.pow((1 - monthlyRateLease), (deliveryTimeVal - delayedFundingVal)) * (1 - (deposit + blindDiscountVal)), residualValuePerTerm * priceMx.value, PaymentDueTime.End)
    let insurance = fundedInsurance.value
    let depositVal = depositValue && depositValue.value || 0
    let initialPayment = (depositPercentage === 0 ? monthlyPayment + insurance : depositVal) / (1 + vatRate)
    let initialPaymentVat = (initialPayment + commissionFeeCalculated) * vatRate

    let vatQc =  mathRound((monthlyPayment + insurance) * vatRate)
    let paymentFromVendor = (priceMx.value - depositVal) * discountFromVendor / 100
    let totalInitialPayment = initialPayment &&  mathRound(commissionFeeCalculated + initialPayment + initialPaymentVat)
        
    let currency = priceMx.currency
    let purchaseOptionPrice = residualValuePerTerm ? mathRound(priceMx.value * residualValuePerTerm) : 1
    let totalPaymentLessInsuranceAndCommission = (totalInitialPayment - commissionFeeCalculated * (1+vatRate))+(monthlyPayment*(1+vatRate)*termVal) + purchaseOptionPrice
    return {
      termIRR,
      initialPaymentVat: initialPaymentVat && {
        value: mathRound(initialPaymentVat),
        currency
      },
      totalPaymentLessInsuranceAndCommission: {
        value: mathRound(totalPaymentLessInsuranceAndCommission),
        currency 
      },
      totalInitialPayment: initialPayment && {
        value: totalInitialPayment,
        currency
      },
      initialPayment: {
        value: mathRound(initialPayment),
        currency
      },
      monthlyPaymentLease: {
        value: mathRound(monthlyPayment),
        currency
      },
      commissionFee: {
        value: mathRound(commissionFeeCalculated),
        currency
      },
      purchaseOptionPrice: {
        value: residualValuePerTerm ? mathRound(priceMx.value * residualValuePerTerm) : 1,
        currency
      },
      paymentFromVendor: paymentFromVendor && {
        value: mathRound(paymentFromVendor),
        currency
      },
      vatPerTerm: monthlyPayment && {
        value: vatQc,
        currency
      },
      totalPayment: {
        value: mathRound(monthlyPayment + insurance + vatQc),
        currency
      },
    }
  }
  
  calcLoan({quote, asset, costOfCapital}) {
    let {
      term,
      vatRate,
      priceMx,
      blindDiscount,
      commissionFeePercent,
      loanDeposit,
    } = quote
    let {
      residualValuePerTerm,
    } = asset
    let {
      // from CostOfCapital
      monthlyRateLoan,
    } = costOfCapital
  
    let termVal = parseInt(term.title.split(' ')[0], 10)
  
    let blindDiscountVal = blindDiscount/100
  
    let deposit = loanDeposit/100
  
    let commissionFeeCalculated = priceMx.value * commissionFeePercent / 100
  
    let discountedLoanPrice = priceMx.value * (1 - blindDiscountVal)
    let initialPayment = (discountedLoanPrice * deposit) + (commissionFeeCalculated * (1 + vatRate))
    let monthlyPaymentLoan = (discountedLoanPrice - deposit * discountedLoanPrice) / termVal
  
    let finCostLoan = (pv(monthlyRateLoan, termVal, monthlyPaymentLoan, residualValuePerTerm, PaymentDueTime.End) / (priceMx.value * (1 - deposit)) + 1) * (1 - deposit)
  
    let currency = priceMx.currency
    return {
      finCostLoan: mathRound(finCostLoan * 100, 2),
      initialPayment: {
        value: mathRound(initialPayment),
        currency
      },
      monthlyPaymentLoan: {
        value: mathRound(monthlyPaymentLoan),
        currency
      },
      commissionFee: {
        value: commissionFeeCalculated,
        currency
      }
    }
  }
  nextMonth(date, numberOfMonths) {
    let m = date.getMonth() + numberOfMonths
    if (m && m % 12 === 0) {
      m = 0
      date.setFullYear(date.getFullYear() + 1)
    }
  
    date.setMonth(m)
  }
  
  mathRound(val, digits) {
    if (!digits)
      digits = 2
    let pow = Math.pow(10, digits)
    return Math.round(val * pow)/pow
  }
}
export const createPlugin: CreatePlugin<void> = ({ bot }, { conf }) => {
  const leasingTransation = new LeasingTransationAPI({ bot })
  const plugin: IPluginLifecycleMethods = {
    async didApproveApplication({ req }) {
      const { application } = req
      if (!application || !application.parent) return

      const requestFor = application.requestFor

      let productConf = conf[requestFor]
      if (!productConf  ||  !productConf.form) return
      const { form:formType } = productConf
      let parentApp = await this.bot.getResource(application.parent, {backlinks: ['forms']})
      
      await leasingTransation.exec({application:parentApp, formType})      
    },
//     async onmessage (req) {
//       let { application, payload } = req
//       if (!application) return
//       const requestFor = application.requestFor

//       let productConf = conf[requestFor]
//       const { form:formType } = productConf
//       if (!productConf  ||  !formType || payload[TYPE] !== formType) return
// debugger      
//       await leasingTransation.exec({application, formType, payload})    
//     }
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

  // calcMinXIRR({costOfCapital, asset, vendor, term, termEnum}) {
  //   let minXIRR = costOfCapital.minXIRR
  //   let adj = 0
  //   if (asset.xirrAdjustmentPerTerm) {
  //     let adjPerTerm = asset.xirrAdjustmentPerTerm.find(r => r.term.id === term.id)
  //     if (adjPerTerm)
  //       adj = adjPerTerm.xirrAdjustment
  //   }
  //   if (!adj  &&  asset.xirrAdjustment)
  //     adj = asset.xirrAdjustment
  //   if (!adj  &&  vendor  &&  vendor.xirrAdjustment)
  //     adj = vendor.xirrAdjustment
  //   minXIRR += adj
  //   // now apply increment for term
  //   let currentTerm = termEnum.find(t => term.id.endsWith(`_${t.id}`))
  //   if (currentTerm && currentTerm.coef)
  //     minXIRR += costOfCapital.xirrIncrement * currentTerm.coef
  
  //   return minXIRR
  // }
  
    // let subset = {
    //   quote: {
    //     term,
    //     factor,
    //     commissionFeePercent,
    //     asset,
    //     netPriceMx,
    //     exchangeRate,
    //     depositPercentage,
    //     deliveryTime,
    //     vatRate,
    //     priceMx,
    //     depositValue,
    //     fundedInsurance,
    //     discountFromVendor,
    //     blindDiscount,
    //     delayedFunding,
    //     residualValueQuote,
    //     loanTerm,
    //     loanDeposit,
    //     termEnum,
    //   },
    //   // from asset
    //   asset: {
    //     listPrice,
    //     maxBlindDiscount,
    //     residualValuePerTerm,
    //     allowLoan,
    //     xirrAdjustmentPerTerm
    //   },
    //   vendor: {
    //     xirrAdjustment,
    //     minFactor
    //   },
    //   // from CostOfCapital
    //   costOfCapital: {
    //     minimumDeposit,
    //     lowDepositPercent,
    //     presentValueFactor,
    //     monthlyRateLease,
    //     monthlyRateLoan,
    //     xirrIncrement,
    //     maxDeposit,
    //     minXIRR,
    //     // configurationItem
    //   },
    // }
