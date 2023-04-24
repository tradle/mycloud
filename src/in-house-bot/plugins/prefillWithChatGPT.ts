import _ from 'lodash'
import AWS from 'aws-sdk'
import { execSync } from 'child_process'

import { TYPE, PERMALINK, LINK, TYPES } from '@tradle/constants'
const {
  MONEY,   
} = TYPES
import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils
import { enumValue } from '@tradle/build-resource'
import { getChatGPTMessage } from '../openAiInterface'

import {
  Bot,
  CreatePlugin,
  ValidatePluginConf,
  Applications,
  IPluginLifecycleMethods,
  Logger,
  ValidatePluginConfOpts
} from '../types'
import { normalizeResponse, getPDFContent } from '../docUtils'

const REFERENCE_DATA_SOURCES = 'tradle.ReferenceDataSources'

type PrefillWithChatGPTOpts = {
  bot: Bot
  conf: IDocumentOcrConf
  applications: Applications
  logger: Logger
  botConf: any
}
interface IDocumentOcrConf {
  [productModelId: string]: {}
}

export class PrefillWithChatGPT {
  private bot: Bot
  private conf: IDocumentOcrConf
  private applications: Applications
  private logger: Logger
  private botConf: any
  constructor({ bot, conf, applications, logger, botConf }: PrefillWithChatGPTOpts) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
    this.logger = logger
    this.botConf = botConf
  }
  public async prefill(payload, prop, req) {
    await this.bot.resolveEmbeds(payload)
    // Form now only 1 doc will be processed
    let base64
    let parts = prop.split('.')
    if (parts.length === 1) {
      if (Array.isArray(payload[prop])) base64 = payload[prop][0].url
      else base64 = payload[prop].url
    }       
    else {
      let res = payload
      let len = parts.length
      for (let i=0; i<parts.length - 1; i++) 
        res = await this.bot.getResource(res[parts[i]])
      
      await this.bot.resolveEmbeds(res)        
      let p = parts[len - 1]
      if (Array.isArray(res[p])) base64 = res[p][0].url
      else base64 = res[p].url
        
    }
    // if (Array.isArray(payload[prop])) base64 = payload[prop][0].url
    // else base64 = payload[prop].url


    let image = await getPDFContent(base64, this.logger)
    if (!image) {
      this.logger.debug(`Conversion to image for property: ${prop} failed`)  
      return
    }
    image = image[0]
    let message 
  // return {error: `File is too big. The current limit is ${MAX_FILE_SIZE/1024/1024} Megabytes`}
    if (typeof image === 'string') 
      message = image
    else {
      let accessKeyId = ''
      let secretAccessKey = ''
      let region = 'us-east-1'
      let textract = new AWS.Textract({
        apiVersion: '2018-06-27',
        accessKeyId,
        secretAccessKey,
        region
      })

      let params = {
        Document: {
          /* required */
          Bytes: image
        }
      }
      let apiResponse
      try {
        apiResponse = await textract.detectDocumentText(params).promise()
      } catch (err) {
        this.logger.debug('Textract error', err)
        return
      }
      message = JSON.stringify(apiResponse.Blocks.map(b => b.Text).filter(a => a !== undefined))
    }
      //  @ts-ignore
      // let analyzeResponse = await textract.analyzeDocument({...params, FeatureTypes: [ 'TABLES', 'FORMS', 'SIGNATURES']}).promise()
    try {  
      let params:any = {
        req, 
        bot: this.bot, 
        conf: this.botConf.bot, 
        message: message.slice(1, message.length - 1)
      }
      const {models} = this.bot
      let model = models[payload[ TYPE]]

      let map = this.conf.map
      if (map && map[payload[TYPE]])
        params.model = models[map[payload[TYPE]]]
      else
        params.model = model
      params.logger = this.logger  
      let response = await getChatGPTMessage(params)
      if (!response) {
        debugger
        return
      }
      // let i = data.length - 2
      // let doTrim
      // for (; data.charAt(i) !== '"'; i--) {
      //   let ch = data.charAt(i)
      //   if (ch === '"') break
      //   if (ch !== ' ' && (ch !== '\n'))
      //     doTrim = true
      // }
      // if (doTrim) 
      //   data = `${data.slice(0, i + 1)}}`
           
      // let lastBracesIdx = data.lastIndexOf('}')
      // if (lastBracesIdx === -1) {
      //   this.logger.debug('the response does not have JSON', data)
      //   return
      // }  
      // if (lastBracesIdx !== data.length - 1)
      //   data = data.slice(0, lastBracesIdx + 1)
      // let response
      // try {
      //   response = JSON.parse(data)
      // } catch (err) {
      //   debugger
      //   // HACK
      //   if (data.charAt(data.length - 3) === ',') {
      //     data.splice(data.length - 3, 1)
      //     response = JSON.parse(data)
      //   }
      // }
      normalizeResponse({response, model, models})
      return response
    } catch (err) {
      debugger
      this.logger.error('textract detectDocumentText failed', err)
      // return { error: err.message }
    }
  }
}

export const createPlugin: CreatePlugin<void> = (components, { conf, logger }) => {
  const { bot, applications, conf: botConf } = components
  if (bot.isLocal) execSync('command -v gs')
  const prefillWithChatGPT = new PrefillWithChatGPT({ bot, conf, applications, logger, botConf })
  // debugger
  const plugin: IPluginLifecycleMethods = {
    async validateForm({ req }) {
      if (botConf.bot['dontUseExternalAI']) return
      const { user, application, payload } = req
      // debugger
      if (!application) return
      let formConf = conf[payload[TYPE]]
      if (!formConf) {
        let { models } = bot
        let m = models[payload[TYPE]]
        formConf = conf[m.subClassOf]
        if (!formConf) return
      }
      const { property } = formConf
      if (!property || !payload[property.split('.')[0]]) return

      if (payload._prevlink && payload[property]) {
        let dbRes = await bot.objects.get(payload._prevlink)
        let pType = bot.models[payload[TYPE]].properties[property].type
        let isArray = pType === 'array'
        let maybeNotChanged
        if (dbRes) {
          if (isArray)
            maybeNotChanged = dbRes[property] && dbRes[property].length === payload[property].length
          else if (dbRes[property] && dbRes[property].url === payload[property].url) return
        }
        if (maybeNotChanged) {
          let dbPhotos = dbRes[property]
          let payloadPhotos = payload[property]
          let same = true
          for (let i = 0; i < dbPhotos.length && same; i++) {
            let url = dbPhotos[i].url
            let idx = payloadPhotos.findIndex(r => r.url === url)
            same = idx !== -1
          }
          if (same) return
        }
      }
      let prefill
      let dataLineage
      try {
        prefill = await prefillWithChatGPT.prefill(payload, property, req)
        if (!prefill) {
          debugger
          return
        }
        if (prefill.error) {
          return {
            message: prefill.error
          }
        }
        prefill = sanitize(prefill).sanitized

        let provider = enumValue({
          model: bot.models[REFERENCE_DATA_SOURCES],
          value: 'amazonTextract'
        })
        dataLineage = {
          [provider.id]: {
            properties: Object.keys(prefill)
          }
        }

        let hasChanges
        for (let p in prefill) {
          if (!payload[p]) hasChanges = true
          else if (typeof payload[p] === 'object' && !_.isEqual(payload[p], prefill[p]))
            hasChanges = true
          else if (payload[p] !== prefill[p]) hasChanges = true
          if (hasChanges) break
        }
        if (!hasChanges) {
          logger.error(
            `prefillWithChatGPT does not send request for correction for ${payload[TYPE]} since the resource didn\'t change`
          )
          return
        }
      } catch (err) {
        debugger
        return
      }
      const payloadClone = _.cloneDeep(payload)
      payloadClone[PERMALINK] = payloadClone._permalink
      payloadClone[LINK] = payloadClone._link

      _.extend(payloadClone, prefill)
      // debugger
      let formError: any = {
        req,
        user,
        application
      }
      formError.details = {
        prefill: payloadClone,
        message: `Please review and correct the data below`
      }
      if (dataLineage) {
        _.extend(formError.details, { dataLineage })
      }
      try {
        await applications.requestEdit(formError)
        return {
          message: 'no request edit',
          exit: true
        }
      } catch (err) {
        debugger
      }
    }
  }

  return { plugin }
}

// function parseMoney1(input) {
//   // Match the currency symbol or code at the beginning or end of the string
//   let inputParts = input.split(' ')
//   const match = inputParts[0].match(/^([$£€¥]|[a-zA-Z0-9]+)?(\d+(\.\d{1,2})?)([$£€¥]|[a-zA-Z0-9]*)?$/);

//   if (match) {
//     // Get the matched currency symbol or code, or use default
//     const currency = match[1] || "$";
//     // Check if the currency is a code or symbol
//     const isCode = !currency.match(/[$£€¥]/);
//     // Get the matched amount
//     const amount = parseFloat(match[2]);

//     return {
//       currency: isCode ? currency.toUpperCase() : currency,
//       value: amount
//     };
//   } 
//   // Return null if no valid money format was found
//   return {};
  
// }

export const validateConf: ValidatePluginConf = async (opts: ValidatePluginConfOpts) => {
  const { bot, conf, pluginConf } = opts
  const { models } = bot
  for (let form in pluginConf) {
    if (!models[form])
      throw new Error(`Invalid model: ${form}`)
    let c = pluginConf[form]  
    if (!c.property)
      throw new Error(`The configuration needs to have 'property' that points to the document that will be processed by this plugin`)
    // if (!models[form].properties[c.property])
    //   throw new Error(`Invalid property: ${c.property} in ${form}`)
  }
}