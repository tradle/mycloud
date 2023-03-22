import _ from 'lodash'
import DataURI from 'strong-data-uri'
import AWS from 'aws-sdk'
import gs from 'node-gs'
import path from 'path'
import fs from 'fs'
import { v4 as uuid } from 'uuid'
import { execSync } from 'child_process'
import sizeof from 'image-size'
import sharp from 'sharp'

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
  Logger,
  ValidatePluginConfOpts
} from '../types'

const MAX_FILE_SIZE = 15728640 // 15 * 1024 * 1024 bytes in 15M
const CURRENCY = 'tradle.Currency'
const REFERENCE_DATA_SOURCES = 'tradle.ReferenceDataSources'
const MAX_WIDTH = 2000

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


    let image = await checkAndResizeResizeImage(base64, this.logger)
  // return {error: `File is too big. The current limit is ${MAX_FILE_SIZE/1024/1024} Megabytes`}

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
      //  @ts-ignore
      // let analyzeResponse = await textract.analyzeDocument({...params, FeatureTypes: [ 'TABLES', 'FORMS', 'SIGNATURES']}).promise()
    try {  
      let message = JSON.stringify(apiResponse.Blocks.map(b => b.Text).filter(a => a !== undefined))
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
      let data = await getChatGPTMessage(params)
      if (!data) {
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
           
      let lastBracesIdx = data.lastIndexOf('}')
      if (lastBracesIdx === -1) {
        this.logger.debug('the response does not have JSON', data)
        return
      }  
      if (lastBracesIdx !== data.length - 1)
        data = data.slice(0, lastBracesIdx + 1)
      let response
      try {
        response = JSON.parse(data)
      } catch (err) {
        debugger
        // HACK
        if (data.charAt(data.length - 3) === ',') {
          data.splice(data.length - 3, 1)
          response = JSON.parse(data)
        }
      }
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
        let moneyVal = makeMoneyValue(val, models)
        if (moneyVal) 
          response[p] = moneyVal
        else
          deleteProps.push(p)        
        continue
      }  
      if (!isEnumProperty({models, property})) {
        deleteProps.push(p)
        continue
      }  
      let pVal = makeEnumValue(val, ref, models)
        // debugger
      if (pVal) {
        response[p] = {
          id: `${ref}_${pVal.id}`,
          title: pVal.title
        } 
      }       
      else
        deleteProps.push(p)    
      // let pVal =  models[ref].enum.find(e => e.id === val || e.title.toLowerCase === val.toLowerCase()) 
    }
    if (deleteProps.length) 
      deleteProps.forEach(p => delete response[p])
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
function makeMoneyValue (val, models) {
  let {currency, value, symbol} = parseMoney(val)
  if (!value)
    return
  
  if (!currency && !symbol) 
    return { value }
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
    return { value, currency: cur.id}
}

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
function makeEnumValue(val, ref, models) {
  let lVal = val.toLowerCase()
  let pVal = models[ref].enum.find(e => e.title.toLowerCase() === lVal)
  if (!pVal) {
    let parts = lVal.split(' ')
    for (let i=0; i<parts.length && !pVal; i++) {
      let partVal = parts[i].toLowerCase()
      pVal = models[ref].enum.find(e => {
        for (let p in e) {
          if (typeof e[p] === 'string' && e[p].toLowerCase() === partVal)
            return true
        }
        return false
      })
    }
    // debugger
  }
  return pVal
}
async function checkAndResizeResizeImage (dataUrl, logger) {
  let pref = dataUrl.substring(0, dataUrl.indexOf(',') + 1)
  
  let buffer: any = DataURI.decode(dataUrl)
  let buf
  let isPDF = pref.indexOf('application/pdf') !== -1
  if (isPDF) {
  // debugger
    try {
      const fileName = uuid()
      buf = await convertPdfToPng(buffer)
    } catch (err) {
      logger.error('document-ocr failed', err)
      return {}
    }
  } 
  else
    buf = DataURI.decode(dataUrl)
  
  return await imageResize({buf, pref, logger, isPDF})  
}
async function convertPdfToPng(pdf: any) {
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

async function imageResize ({buf, pref, logger, maxWidth, isPDF}:{buf:Buffer, pref: string, maxWidth?:number, logger: Logger, isPDF?: boolean}) {
  let isTooBig = buf.length > MAX_FILE_SIZE
  if (!isTooBig) {
    if (!isPDF)
      return buf
  }
  
  let dimensions: any = sizeof(buf);
  let currentWidth: number = dimensions.width
  let currentHeight: number = dimensions.height
  logger.debug(`prefillWithChatGPT image original w=${currentWidth}' h=${currentHeight}`)
  let biggest = currentWidth > currentHeight ? currentWidth : currentHeight
  if (!maxWidth)
    maxWidth = MAX_WIDTH
  let coef: number = maxWidth / biggest
  // Need to resize image from PDF  at least once
  if (isPDF && !isTooBig && coef >= 1)
    coef = 0.9 

  if (currentWidth < currentHeight) { // rotate
    let resizedBuf: any
    let width: number = currentHeight
    let height: number = currentWidth
    if (coef < 1) { // also resize
      width = Math.round(currentHeight * coef)
      height = Math.round(currentWidth * coef)
      resizedBuf = await sharp(buf).rotate(-90).resize(width, height).toBuffer()
      logger.debug(`prefillWithChatGPT image resized and rotated w=${width}' h=${height}`)
    }
    else {
      resizedBuf = await sharp(buf).rotate(-90).toBuffer()
      logger.debug(`prefillWithChatGPT image rotated w=${width}' h=${height}`)
    }
    let newDataUrl = pref + resizedBuf.toString('base64')
    buf = DataURI.decode(newDataUrl)
    return imageResize({buf, pref, logger, maxWidth: maxWidth / 2})
  }
  if (coef < 1) {
    let width = Math.round(currentWidth * coef)
    let height = Math.round(currentHeight * coef)
    let resizedBuf = await sharp(buf).resize(width, height).toBuffer()
    let newDataUrl = pref + resizedBuf.toString('base64')
    logger.debug(`prefillWithChatGPT image resized w=${width}' h=${height}`)
    buf = DataURI.decode(newDataUrl)
    return imageResize({buf, pref, logger, maxWidth: maxWidth / 2})    
  }
  logger.debug(`prefillWithChatGPT image no change`)
  return buf
}
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