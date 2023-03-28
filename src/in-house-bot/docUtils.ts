import { extend, cloneDeep } from 'lodash'
import AWS from 'aws-sdk'
import gs from 'node-gs'
import path from 'path'
import fs from 'fs'
import { v4 as uuid } from 'uuid'
import DataURI from 'strong-data-uri'
import sizeof from 'image-size'
import sharp from 'sharp'
import validateModels from '@tradle/validate-model'
const { isEnumProperty } = validateModels.utils
import { TYPE } from '@tradle/constants'

import {
  Logger, 
  Bot, 
} from '../types'

const AI_CORPORATION_CHECK = 'tradle.AICorporationCheck'
const CURRENCY = 'tradle.Currency'
const MONEY = 'tradle.Money'
const MAX_FILE_SIZE = 15728640 // 15 * 1024 * 1024 bytes in 15M
const MAX_WIDTH = 2000

// Question to ChatGPT for the future: You are a JSON writer. Show the 3166 ISO code for Wales in JSON format.  No words in your answer just JSON.
// const ISO3166_COUNTRIES = {
//   "England": "United Kingdom",
//   "Scotland": "United Kingdom",
//   "Wales": "United Kingdom",
//   "Northern Ireland": "United Kingdom",
// }
export async function checkAndResizeResizeImage (dataUrl, logger) {
  let pref = dataUrl.substring(0, dataUrl.indexOf(',') + 1)
  
  let buffer: any = DataURI.decode(dataUrl)
  let buf
  let isPDF = pref.indexOf('application/pdf') !== -1
  if (isPDF) {
  // debugger
    try {
      const fileName = uuid()
      buf = await convertPdfToPng(buffer, logger)
    } catch (err) {
      logger.error('document-ocr failed', err)
      return {}
    }
  } 
  else
    buf = DataURI.decode(dataUrl)
  
  return await imageResize({buf, pref, logger, isPDF})  
}
export async function doTextract(image) {
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
  let message = JSON.stringify(apiResponse.Blocks.map(b => b.Text).filter(a => a !== undefined))

  return {apiResponse, message}
}
export function  normalizeResponse({response, model, models}) {
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
    // if (!pVal && ref === COUNTRY) {
    //   let v = ISO3166_COUNTRIES[val]
    //   if (v)
    //     pVal = makeEnumValue(v, ref, models)
    // }
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
  return response  
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
  let pVal = models[ref].enum.find(e => e.title.toLowerCase() === lVal || e.id.toLowerCase() === lVal)
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
async function convertPdfToPng(pdf, logger) {
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
      '../../node_modules/lambda-ghostscript/bin/gs'
    )
    gsOp.executablePath(ghostscriptPath)
  }

  return new Promise((resolve, reject) => {
    gsOp.exec(pdf, (error, stdout, stderror) => {
      if (error) {
        logger.debug(error)
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

export async function getLEfromAiCheck({application, bot}) {
  let check = application.checks.find(check => check[TYPE] === AI_CORPORATION_CHECK)
  if (!check) return
  check = bot.getResource(check)
  return check.rawData.companyFormationDocument
}

export async function getCPfromAiCheck({application, bot}) {
  let check = application.checks.find(check => check[TYPE] === AI_CORPORATION_CHECK)
  if (!check) return
  check = bot.getResource(check)
  let cp = check.rawData.articlesOfAssociationDocument
}

