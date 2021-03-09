import cloneDeep from 'lodash/cloneDeep'
import size from 'lodash/size'
import extend from 'lodash/extend'

import { CreatePlugin, IPBReq, IPluginLifecycleMethods, ValidatePluginConf } from '../types'
import { TYPE } from '@tradle/constants'
import validateResource from '@tradle/validate-resource'
import { getLatestForms } from '../utils'
import { isSubClassOf } from '../utils'
// @ts-ignore
const { parseStub, sanitize } = validateResource.utils

const PRODUCT_REQUEST = 'tradle.ProductRequest'
const FORM_REQUEST = 'tradle.FormRequest'
const APPLICATION = 'tradle.Application'
const ENUM = 'tradle.Enum'
const CHECK = 'tradle.Check'
const QUATATION_DETAIL = 'com.leaseforu.QuoteDetail'
const QUOTATION_CONFIGURATION = 'com.leaseforu.QuotationConfiguration'

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const plugin: IPluginLifecycleMethods = {
    async willRequestForm({ application, formRequest }) {
      if (!application) return

      const requestFor = application.requestFor

      let productConf = conf[requestFor]

      if (!productConf) return

      let ftype = formRequest.form
      let pConf = productConf[ftype] 
      if (!pConf) return

      let model = bot.models[ftype]
      if (!model) return

      const stubs = getLatestForms(application)
      let qiStub = stubs.find(({ type }) => type.endsWith('QuotationInformation'))
      if (!qiStub) return
      const quotationInfo = await bot.getResource(qiStub)
      let { 
        factor, 
        netPrice,
        assetName,
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

      let { quotationConfiguration } = conf
      if (!quotationConfiguration) {
        try {
          let qc = await bot.db.findOne({
            filter: {
              EQ: {
                [TYPE]: QUOTATION_CONFIGURATION,
                configuration: assetName
              }
            }
          })
          quotationConfiguration = qc.items
        } catch (err) {
          return
        }
      }

      let quotationDetails = []
      quotationConfiguration.forEach(qc => {
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
        let factorPercentage = mathRound(factor / 100 / 12 * termVal)

        let dtID = deliveryTime.id.split('_')[1] 
        let deliveryTermPercentage = qc[dtID]

        let totalPercentage = mathRound(factorPercentage + deliveryTermPercentage + depositPercentage + lowDepositPercent)
        let payment = (netPriceMx.value - depositValue.value - (residualValue/(1 + (factorVPdelVR/100))/ vat.value * totalPercentage/termVal))
        let insurance = fundedInsurance.value
        let initialPayment = depositPercentage === 0 && payment + insurance || depositValue.value / (1 + vatRate)
        let initialPaymentVat = (initialPayment + commissionFee) * vatRate
        let commissionFeeQc = commissionFee * priceMx.value
        let currency = netPriceMx.currency
        let vatQc =  mathRound((payment + insurance) * vatRate)
        let qd = {
          [TYPE]: ftype,
          factorPercentage: factor / 100 / 12 * termVal,
          deliveryTermPercentage,
          // depositFactor:
          lowDepositFactor: depositPercentage > lowDeposit && 0 || lowDepositPercent,
          term,
          commissionFee: commissionFeeQc  &&  {
            value: mathRound(commissionFeeQc),
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
            value: mathRound(commissionFeeQc + initialPayment + initialPaymentVat),
            currency
          },
          monthlyPayment: payment  &&  {
            value: mathRound(payment),
            currency
          },
          monthlyInsurance: fundedInsurance,
          vat: payment && {
            value: vatQc,
            currency
          }, 
          totalPayment: payment && {
            value: mathRound(payment + insurance + vatQc),
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
      debugger

      let prefill = {
        type: QUATATION_DETAIL,
        terms: quotationDetails
      }
      // allFormulas.forEach(async val => {
      //   let [propName, formula] = val
      //   try {
      //     let value = new Function('forms', 'application', `return ${formula}`)(forms, application)
      //     prefill[propName] = value
      //   } catch (err) {
      //     debugger
      //   }
      // })
      // prefill = sanitize(prefill).sanitized
      if (!size(prefill)) return
      // normalizeEnumForPrefill({ form: prefill, model: bot.models[ftype], models: bot.models })
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
/*
const TERMS = [
  {
    term: {
      id: 'io.lenka.Term_t1'
    },
    commissionFee: {
      currency: {
        id: "tradle.Currency_USD",
        title: "US dollar" 
      },
      value: 20000
    },
    initialPayment: {
      currency: {
        id: "tradle.Currency_USD",
        title: "US dollar" 
      },
      value: 86206.90
    },
    initialPaymentVat: {
      currency: {
        id: "tradle.Currency_USD",
        title: "US dollar" 
      },
      value: 16993.10            
    },
    totalInitialPayment: {
      currency: {
        id: "tradle.Currency_USD",
        title: "US dollar" 
      },
      value: 123200                          
    },
    monthlyPayment: {
      currency: {
        id: "tradle.Currency_USD",
        title: "US dollar" 
      },
      value: 58867.34                          
    },
    insurance: {
      currency: {
        id: "tradle.Currency_USD",
        title: "US dollar" 
      },
      value: 829.74                          
    },
    vat: {
      currency: {
        id: "tradle.Currency_USD",
        title: "US dollar" 
      },
      value: 9551.53                          
    },
    totalPayment: {
      currency: {
        id: "tradle.Currency_USD",
        title: "US dollar" 
      },
      value: 69248.61                          
    },
    purchaseOption: {
      currency: {
        id: "tradle.Currency_USD",
        title: "US dollar" 
      },
      value: 300000                          
    }
  },
  {
    term: {
      id: 'io.lenka.Term_t2'
    },
    commissionFee: {
      currency: {
        id: "tradle.Currency_USD",
        title: "US dollar" 
      },
      value: 20000
    },
    initialPayment: {
      currency: {
        id: "tradle.Currency_USD",
        title: "US dollar" 
      },
      value: 86206.90
    },
    initialPaymentVat: {
      currency: {
        id: "tradle.Currency_USD",
        title: "US dollar" 
      },
      value: 16993.10            
    },
    totalInitialPayment: {
      currency: {
        id: "tradle.Currency_USD",
        title: "US dollar" 
      },
      value: 123200                          
    },
    monthlyPayment: {
      currency: {
        id: "tradle.Currency_USD",
        title: "US dollar" 
      },
      value: 45210.92                          
    },
    insurance: {
      currency: {
        id: "tradle.Currency_USD",
        title: "US dollar" 
      },
      value: 829.74                          
    },
    vat: {
      currency: {
        id: "tradle.Currency_USD",
        title: "US dollar" 
      },
      value: 7366.51                          
    },
    totalPayment: {
      currency: {
        id: "tradle.Currency_USD",
        title: "US dollar" 
      },
      value: 53407.17                          
    },
    purchaseOption: {
      currency: {
        id: "tradle.Currency_USD",
        title: "US dollar" 
      },
      value: 250000                          
    }
  },
  {
    term: {
      id: 'io.lenka.Term_t3'
    },
    commissionFee: {
      currency: {
        id: "tradle.Currency_USD",
        title: "US dollar" 
      },
      value: 20000
    },
    initialPayment: {
      currency: {
        id: "tradle.Currency_USD",
        title: "US dollar" 
      },
      value: 86206.90
    },
    initialPaymentVat: {
      currency: {
        id: "tradle.Currency_USD",
        title: "US dollar" 
      },
      value: 16993.10            
    },
    totalInitialPayment: {
      currency: {
        id: "tradle.Currency_USD",
        title: "US dollar" 
      },
      value: 123200                          
    },
    monthlyPayment: {
      currency: {
        id: "tradle.Currency_USD",
        title: "US dollar" 
      },
      value: 38218.39                          
    },
    insurance: {
      currency: {
        id: "tradle.Currency_USD",
        title: "US dollar" 
      },
      value: 829.74                          
    },
    vat: {
      currency: {
        id: "tradle.Currency_USD",
        title: "US dollar" 
      },
      value: 6247.70                          
    },
    totalPayment: {
      currency: {
        id: "tradle.Currency_USD",
        title: "US dollar" 
      },
      value: 45295.83                          
    },
    purchaseOption: {
      currency: {
        id: "tradle.Currency_USD",
        title: "US dollar" 
      },
      value: 200000                          
    }
  },
]
*/