// @ts-ignore
import Promise = require('bluebird')
import _ = require('lodash')
import { SIG } from '@tradle/constants'
import engine = require('@tradle/engine')

type ValuesFilterInput = {
  message: any
  payload: any
  property: string
  to: string
}

type ValuesFilter = (opts:ValuesFilterInput) => any

type GetRecipients = (opts) => string[]|void

type PartialsConf = {
  filterValues: ValuesFilter
  getRecipients: GetRecipients
}

export const createPlugin = opts => {
  const { onmessage } = new Partials(opts)
  return { onmessage }
}

export class Partials {
  private bot: any
  private productsAPI: any
  private models: any
  private conf: any
  constructor({ bot, productsAPI, models, conf }: {
    bot: any,
    productsAPI: any,
    models: any,
    conf: PartialsConf
  }) {
    this.bot = bot
    this.productsAPI = productsAPI
    this.models = models
    this.conf = _.defaults(conf, confDefaults)
    this.onmessage = this.onmessage.bind(this)
  }

  public onmessage = async (opts) => {
    const { getRecipients } = this.conf
    const recipients = getRecipients(opts)
    if (recipients && recipients.length) {
      await Promise.map(recipients, to => this.sendPartial({ ...opts, to }))
    }
  }

  public sendPartial = async ({ req, message, payload, to }) => {
    const {
      productsAPI,
      filterValues
    } = this.conf

    const builder = engine.partial.from(payload)
    // add ALL keys, and SOME values
    const keepValues = Object.keys(payload).filter(property => {
      if (property === SIG) return false

      return filterValues({
        message,
        object: payload,
        property,
        to
      })
    })

    keepValues.forEach(property => builder.add({
      property,
      key: true,
      value: true
    }))

    const other:any = {
      originalSender: message._author
    }

    if (message.context) other.context = message.context

    const partial = builder.build()
    return await this.productsAPI.send({ req, to, object: partial })
  }
}

// const defaultGetRecipients = ({ user, message, payload, type, model }) => {
//   return model.subClassOf === 'tradle.Form' ||
//     model.subClassOf === 'tradle.MyProduct' ||
//     type === 'tradle.ProductApplication'    ||
//     type === 'tradle.Verification'          ||
//     type === 'tradle.FormRequest'           ||
//     type === 'tradle.FormError'
// }

const confDefaults:PartialsConf = {
  filterValues: (opts:ValuesFilterInput) => false,
  getRecipients: (opts) => []
}
