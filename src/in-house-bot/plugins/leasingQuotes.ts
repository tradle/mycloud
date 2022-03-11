import size from 'lodash/size'
import extend from 'lodash/extend'
import {
  CreatePlugin,
  Bot,
  Logger,
  Applications,
  IPluginLifecycleMethods,
  ValidatePluginConf
} from '../types'
import { TYPE } from '@tradle/constants'
import { getLatestForms } from '../utils'
// @ts-ignore

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
  public async amortizationPerMonth({application, formRequest, form}) {
    const stubs = getLatestForms(application)
    let qiStub = stubs.find(({ type }) => type === form)
    if (!qiStub) return
    const quotationInfo = await this.bot.getResource(qiStub)
    const {
      netPriceMx
    } = quotationInfo
    const quotationDetail = quotationInfo

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

      let ftype = formRequest.form
      if (!productConf || !productConf[ftype]) return

      let { form } = productConf[ftype]
      if (!form) return

      let model = bot.models[ftype]
      if (!model) return

      let prefill = await leasingQuotes.amortizationPerMonth({application, formRequest, form})

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

