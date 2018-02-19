import _ = require('lodash')
import validateResource = require('@tradle/validate-resource')
import { TYPE } from '@tradle/constants'
import { Conf } from '../configure'
import {
  getNameFromForm,
  getDateOfBirthFromForm,
  getCountryFromForm,
  parseScannedDate
} from '../utils'
import { Bot, IPBApp, ResourceStub, Name, IPluginOpts } from '../types'

const { parseStub } = validateResource.utils
const PHOTO_ID = 'tradle.PhotoID'
const ONFIDO_APPLICANT = 'tradle.onfido.Applicant'

// const canPrefillFromPhotoID = ({ application, formRequest }) => {
//   if (!doesApplicationHavePhotoID(application)) return false

//   const { form } = formRequest
//   return form === 'tradle.Name' ||
//     form === 'tradle.onfido.Applicant' ||
//     form === 'tradle.Address'
// }

// const doesApplicationHavePhotoID = ({ application, models }) => {
//   const model = this.bot.models[application.requestFor]
//   if (!model) return

//   const forms = model.forms.concat(model.additionalForms || [])
//   if (!forms.includes(PHOTO_ID)) return
// }

// interface ISmartPrefillProductConf {
//   // prefill form A from forms [X, Y, Z]
//   [targetForm: string]: string[]
// }

interface ISmartPrefillConf {
  // [product: string]: ISmartPrefillProductConf
  [product: string]: {
    [targetForm: string]: string[]
  }
}

interface IPersonalInfo {
  firstName?: string
  lastName?: string
  dateOfBirth?: number
  country?: ResourceStub
}

export const extractors = {
  [PHOTO_ID]: (form: IPersonalInfo) => {
    const props:IPersonalInfo = getNameFromForm(form) || {}
    const dateOfBirth = getDateOfBirthFromForm(form)
    if (dateOfBirth) props.dateOfBirth = dateOfBirth

    const country = getCountryFromForm(form)
    if (country) props.country = country

    return props
  }
}

export const transformers = {
  [PHOTO_ID]: {
    [ONFIDO_APPLICANT]: (source: IPersonalInfo) => {
      const props:any = {}
      if (source.firstName) props.givenName = source.firstName
      if (source.lastName) props.surname = source.lastName

      _.extend(props, _.pick(source, ['dateOfBirth', 'country']))
      return props
    }
  }
}

type SmartPrefillOpts = {
  bot: Bot
  conf: any
}

export class SmartPrefill {
  private bot: Bot
  private conf: ISmartPrefillConf
  constructor({ bot, conf }: SmartPrefillOpts) {
    this.bot = bot
    this.conf = conf
  }

  public prefill = async ({ application, formRequest }) => {
    if (!application) return

    const { requestFor } = application
    const { form, prefill={} } = formRequest
    const productConf = this.conf[requestFor] || {}
    const sources = productConf[form] || []
    if (!sources.length) return

    const inputs = application.forms.map(parseStub)
      .filter(stub => sources.includes(stub.type))
      .map(stub => {
        const transformInput = transformers[stub.type]
        return {
          stub,
          extractor: extractors[stub.type],
          transformer: transformInput && transformInput[form]
        }
      })
      .filter(({ extractor, transformer }) => extractor && transformer)

    if (!inputs.length) return

    for (const { stub, extractor, transformer } of inputs) {
      const source = await this.bot.getResource(stub)
      const props = extractor(source)
      _.defaults(prefill, transformer(props))
    }

    if (_.size(prefill)) {
      if (!prefill[TYPE]) prefill[TYPE] = form

      formRequest.prefill = prefill
    }
  }
}

export const createPlugin = (opts: IPluginOpts) => {
  const smarty = new SmartPrefill(opts as SmartPrefillOpts)
  return {
    willRequestForm: async ({ application, formRequest }) => {
      try {
        return await smarty.prefill({ application, formRequest })
      } catch (err) {
        console.error('failed to smart-prefill form', {
          stack: err.stack
        })
      }
    }
  }
}

export const validateConf = async ({ conf, pluginConf }: {
  conf: Conf,
  pluginConf: ISmartPrefillConf
}) => {
  const { models } = conf.bot
  for (let appType in pluginConf) {
    let toPrefill = pluginConf[appType]
    for (let target in toPrefill) {
      if (!models[target]) throw new Error(`missing model: ${target}`)

      let sources = toPrefill[target]
      sources.forEach(source => {
        if (!models[source]) throw new Error(`missing model: ${source}`)
      })
    }
  }
}
