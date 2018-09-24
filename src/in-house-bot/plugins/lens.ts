import _ from 'lodash'
import { TYPE, SIG, PERMALINK } from '@tradle/constants'
import Lens from '@tradle/lens'
import buildResource from '@tradle/build-resource'
import validateResource from '@tradle/validate-resource'
import { Conf } from '../configure'
import { Bot, Logger, IPBApp, CreatePlugin, ValidatePluginConf } from '../types'

const ValidationErrors = validateResource.Errors

type LensPluginOpts = {
  bot: Bot
  logger: Logger
  conf: any
}

export const name = 'lens'
export const description = `
Performs two functions:
1. sets "lens" property on outbound form requests based on configuration
2. validates inbound forms against lenses, and requests edits
`

export class LensPlugin {
  private bot: Bot
  private conf: any
  private logger: Logger
  constructor({ bot, conf, logger }: LensPluginOpts) {
    this.bot = bot
    this.conf = conf
    this.logger = logger
  }

  public willSend = ({ req, to, object, application }) => {
    if (!object || object[SIG]) return

    const form = this._getForm(object)
    if (!form) return

    if (!application && req) application = req.application

    const lens = this._getLens({ form, application })
    if (!lens) return

    this.logger.debug('setting lens on form request', {
      form: form[TYPE],
      lens,
      product: application && application.requestFor
    })

    object.lens = lens
  }

  public validateForm = ({ application, form }) => {
    const type = form[TYPE]
    const lensId = this._getLens({ application, form: type })
    if (!lensId) return

    const { models, lenses } = this.bot
    const lens = lenses[lensId]
    if (!lens) {
      this.logger.error(`missing lens ${lensId}`)
      return
    }

    const originalModel = models[type]
    let model
    try {
      model = Lens.merge({ models, model: originalModel, lens })
    } catch (err) {
      this.logger.error(`failed to merge model with lens`, err)
      return
    }

    let err:any
    try {
      validateResource.resource({
        models,
        model,
        resource: form
      })

      return
    } catch (e) {
      err = e
    }

    const ret = {}
    const prefill = _.cloneDeep(form)
    if (!prefill[PERMALINK] && prefill[SIG]) {
      prefill[PERMALINK] = buildResource.link(prefill)
    }

    if (err instanceof ValidationErrors.Required) {
      this.logger.debug('requesting additional properties', err)
      return {
        message: 'Please fill out these additional properties',
        requestedProperties: err.properties.map(name => ({ name }))
      }
    }

    if (err instanceof ValidationErrors.InvalidPropertyValue) {
      this.logger.debug('requesting corrections', err)
      return {
        message: 'Please correct the highlighted property',
        errors: [{
          name: err.property,
          // this is a terrible message!
          message: 'invalid value'
        }]
      }
    }

    this.logger.error(`don't know how to report validation error to user`, err)
  }

  private _getLens = ({ form, application }: {
    form:string,
    application: IPBApp
  }) => {
    const appSpecific = application && this.conf[application.requestFor]
    let lens
    if (appSpecific) {
      lens = appSpecific[form]
    }

    return lens || this.conf[form]
  }

  private _getForm = (object:any):string|void => {
    const type = object[TYPE]
    let form:string
    if (type === 'tradle.FormRequest') {
      return object.form
    }

    if (type === 'tradle.FormError') {
      const { prefill } = object
      if (!prefill) return

      const type = prefill[TYPE]
      if (type) return type
    }
  }
}

export const createPlugin:CreatePlugin<void> = ({ bot }, { conf, logger }) => ({
  plugin: new LensPlugin({ bot, logger, conf })
})

export const validateConf:ValidatePluginConf = async ({ bot, conf, pluginConf }) => {
  const { modelsPack } = conf
  const { lenses=[] } = modelsPack || {}
  const lensesById = _.groupBy(lenses, 'id')
  for (let type in pluginConf) {
    let vals = pluginConf[type]
    for (let subType in vals) {
      let lensId = vals[subType]
      if (lensId) {
        let lens = lensesById[lensId]
        if (!lens) throw new Error(`missing lens: ${lensId}`)
      }
    }
  }
}
