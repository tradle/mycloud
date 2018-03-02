import _ = require('lodash')
import { TYPE, SIG, PERMALINK } from '@tradle/constants'
import Lens = require('@tradle/lens')
import buildResource = require('@tradle/build-resource')
import validateResource = require('@tradle/validate-resource')
import { Conf } from '../configure'
import { parseId } from '../../utils'
import { Bot, Logger, IPBApp, IPBReq, IPluginOpts } from '../types'

const ValidationErrors = validateResource.Errors
export const name = 'lens'
export class LensPlugin {
  private bot: Bot
  private conf: any
  private logger: Logger
  constructor({ bot, conf, logger }: IPluginOpts) {
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
      return {
        message: 'Please fill out these additional properties',
        requestedProperties: err.properties.map(name => ({ name }))
      }
    }

    if (err instanceof ValidationErrors.InvalidPropertyValue) {
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

      if (prefill.id) return parseId(prefill.id).type
    }
  }
}

export const createPlugin = (opts: IPluginOpts) => new LensPlugin(opts)
export const validateConf = async ({ conf, pluginConf }: {
  conf: Conf,
  pluginConf: any
}) => {
  const modelsPack = await conf.modelStore.getCumulativeModelsPack({ force: true })
  const { lenses=[] } = modelsPack || []
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
