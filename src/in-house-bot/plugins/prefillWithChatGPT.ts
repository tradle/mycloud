import _ from 'lodash'
import DataURI from 'strong-data-uri'
import AWS from 'aws-sdk'
import gs from 'node-gs'
import path from 'path'
import fs from 'fs'
import { v4 as uuid } from 'uuid'
import { execSync } from 'child_process'

import { TYPE, PERMALINK, LINK, TYPES } from '@tradle/constants'
const {
  MONEY,   
} = TYPES
import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils
import { enumValue } from '@tradle/build-resource'
import validateModels from '@tradle/validate-model'
import { getChatGPTMessage } from '../openAiInterface'
const { isEnumProperty } = validateModels.utils

import {
  Bot,
  CreatePlugin,
  ValidatePluginConf,
  Applications,
  IPluginLifecycleMethods,
  Logger
} from '../types'

const COUNTRY = 'tradle.Country'
const CURRENCY = 'tradle.Currency'
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
    if (Array.isArray(payload[prop])) base64 = payload[prop][0].url
    else base64 = payload[prop].url

    let buffer: any = DataURI.decode(base64)
    let image
    // debugger
    if (buffer.mimetype === 'application/pdf') {
      try {
        image = await this.convertPdfToPng(buffer)
      } catch (err) {
        this.logger.error('document-ocr failed', err)
        return {}
      }
    } else image = buffer

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
    try {
      let apiResponse = await textract.detectDocumentText(params).promise()
      //  @ts-ignore
      // let analyzeResponse = await textract.analyzeDocument({...params, FeatureTypes: [ 'TABLES', 'FORMS', 'SIGNATURES']}).promise()
      
      let message = JSON.stringify(apiResponse.Blocks.map(b => b.Text).filter(a => a !== undefined))
      let data = await getChatGPTMessage({req, bot: this.bot, conf: this.botConf.bot, message: message.slice(1, message.length - 1)})
      if (!data) {
        debugger
        return
      }
      let i = data.length - 2
      let doTrim
      for (; data.charAt(i) !== '"'; i--) {
        if (data.charAt(i) === '"') break
        if (data.charAt(i) !== ' ')
          doTrim = true
      }
      if (doTrim) 
        data = `${data.slice(0, i + 1)}}`
      
      let response = JSON.parse(data)

      const {models} = this.bot
      let model = models[payload[ TYPE]]
      this.normalizeResponse({response, model, models})
      return response
    } catch (err) {
      debugger
      this.logger.error('textract detectDocumentText failed', err)
      // return { error: err.message }
    }
  }
  normalizeResponse({response, model, models}) {
    let { properties } = model
    let deleteProps = []
    for (let p in response) {
      let val = response[p]
      if (!val.length) continue

      const property = properties[p]
      if (!property) {
        deleteProps.push(p)
        continue
      }
        
      const { type, ref, items } = property
      if (type === 'date') {
        response[p] = new Date(val).getTime()
        continue
      }
      if (type !== 'object')
        continue
      if (ref === MONEY) {
        let {currency, value, symbol} = parseMoney(val)
        if (!value)
          continue
        response[p] = { value }
        if (!currency && !symbol) {
          deleteProps.push(p)
          continue
        }
        // check if it is symbol
        let oneOf = models[MONEY].properties.currency.oneOf
        let curEnum = models[CURRENCY].enum
        let cur
        if (currency) 
          cur = curEnum.find(c => c.id === currency)
        
        else if (symbol) {
          cur = oneOf.find(c => Object.values(c)[0] === symbol)
          if (cur) 
            cur = curEnum.find(c => c.id === cur)          
        }
        if (cur) 
          response[p].currency = cur.id
        else 
          deleteProps.push(p)
        continue
      }  
      if (!isEnumProperty({models, property})) {
        deleteProps.push(p)
        continue
      }  
      let lVal = val.toLowerCase()
      let isCountry = ref === COUNTRY
      let pVal = models[ref].enum.find(e => e.title.toLowerCase() === lVal || (isCountry && e.nationality.toLowerCase() === lVal))
      if (!pVal) {
        let parts = lVal.split(' ')
        for (let i=0; i<parts.length && !pVal; i++) 
          pVal = models[ref].enum.find(e => e.title.toLowerCase() === lVal || (isCountry && e.nationality.toLowerCase() === lVal))
        // debugger
        if (!pVal) {
          deleteProps.push(p)
          continue
        }
      }
      // let pVal =  models[ref].enum.find(e => e.id === val || e.title.toLowerCase === val.toLowerCase()) 
      response[p] = {
        id: `${ref}_${pVal.id}`,
        title: pVal.title
      }        
    }
    if (deleteProps.length) 
      deleteProps.forEach(p => delete response[p])
  }
  public convertPdfToPng = async (pdf: any) => {
    const fileName = uuid()
    let gsOp = gs()
      .option('-r' + 1200)
      .option('-dFirstPage=1')
      .option('-dLastPage=1')
      .device('png16m')
      .output('/tmp/' + fileName + '-%d.png')

    if (process.env.LAMBDA_TASK_ROOT) {
      const ghostscriptPath = path.resolve(
        __dirname,
        '../../../node_modules/lambda-ghostscript/bin/gs'
      )
      gsOp.executablePath(ghostscriptPath)
    }

    return new Promise((resolve, reject) => {
      gsOp.exec(pdf, (error, stdout, stderror) => {
        if (error) {
          this.logger.debug(error)
        }
        // debugger
        const outfile = '/tmp/' + fileName + '-1.png'
        if (fs.existsSync(outfile)) {
          let png = fs.readFileSync(outfile)
          // remove file
          // fs.unlink(outfile, (err) => { })
          //console.log('png file size ', png.length)
          resolve(png)
        } else reject(new Error('no png file generated'))
      })
    })
  }

}

export const createPlugin: CreatePlugin<void> = (components, { conf, logger }) => {
  const { bot, applications, conf: botConf } = components
  if (bot.isLocal) execSync('command -v gs')
  const prefillWithChatGPT = new PrefillWithChatGPT({ bot, conf, applications, logger, botConf })
  // debugger
  const plugin: IPluginLifecycleMethods = {
    async validateForm({ req }) {
      const { user, application, payload } = req
      // debugger
      if (!application) return
      const formConf = conf[payload[TYPE]]
      if (!formConf) return
      const { property } = formConf
      if (!property || !payload[property]) return

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
        if (!prefill)
          debugger
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
function parseMoney(input) {
  // Match the currency symbol or code at the beginning or end of the string

  const inputParts = input.split(' ')
  const match = inputParts[0].match(/^([a-zA-Z]{3}|[^\w\s])?([\d,]+(\.\d{1,2})?)[a-zA-Z]*?$/);

  if (match) {
    // Get the matched currency symbol or use default
    const symbol = match[1] || "$";
    // Remove commas from the matched amount and parse as float
    const value = parseFloat(match[2].replace(/,/g, ""));

    return {
      symbol,
      currency: inputParts.length === 2 && inputParts[1],
      value
    };
  } else {
    // Return null if no valid money format was found
    return null;
  }
}
