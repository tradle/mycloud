import AWS from 'aws-sdk'
import gs from 'node-gs'
import path from 'path'
import fs from 'fs'
import util from 'util'
import { PDFDocument } from 'pdf-lib'
import pdfParse from 'pdf-parse'
import { v4 as uuid } from 'uuid'
import DataURI from 'strong-data-uri'
// import sizeof from 'image-size'
// import sharp from 'sharp'

import validateModels from '@tradle/validate-model'
const { isEnumProperty } = validateModels.utils

import {
  Logger,
} from '../types'

const CURRENCY = 'tradle.Currency'
const MONEY = 'tradle.Money'

// Question to ChatGPT for the future: You are a JSON writer. Show the 3166 ISO code for Wales in JSON format.  No words in your answer just JSON.
// const ISO3166_COUNTRIES = {
//   "England": "United Kingdom",
//   "Scotland": "United Kingdom",
//   "Wales": "United Kingdom",
//   "Northern Ireland": "United Kingdom",
// }
export async function getPDFContent (dataUrl, logger) {
  let pref = dataUrl.substring(0, dataUrl.indexOf(',') + 1)
  // let filePath = `dataUrl.txt`
  // fs.writeFile(filePath, dataUrl, (err) => {
  //   if (err) {
  //     console.error(err);
  //   } else {
  //     console.log('Data saved to file successfully');
  //   }
  // });

  let buffer: any = DataURI.decode(dataUrl)
  let bufStr = buffer.toString('base64')
logger.debug(`First 100 characters: ${bufStr.slice(0, 100)}`)
logger.debug(`Last 100 characters: ${bufStr.slice(-100)}`)
  let isPDF = pref.indexOf('application/pdf') !== -1
  if (isPDF)
    return await getContent(buffer, logger)
  else
    return [DataURI.decode(dataUrl)]
  // return await imageResize({buf, pref, logger, isPDF})
}
export async function doTextract(image, logger) {
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
    logger.debug('Textract error', err)
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
    .option('-dMinFeatureSize=2')
    .device('pngmonod')
    .output('/tmp/' + fileName + '-%d.png')

  if (process.env.LAMBDA_TASK_ROOT) {
    const ghostscriptPath = path.resolve(
      __dirname,
      '../../node_modules/lambda-ghostscript/bin/gs'
    )
    gsOp.executablePath(ghostscriptPath)
  }
  try {
    const gsExec = util.promisify(gsOp.exec.bind(gsOp));
    await gsExec(pdf);

    // await util.promisify(gsOp.exec)(pdf, args);

    const outfile = '/tmp/' + fileName + '-1.png';
    if (fs.existsSync(outfile)) {
      let png = fs.readFileSync(outfile);
      // remove file
      // fs.unlink(outfile, (err) => {});
      return png;
    } else {
      throw new Error('no png file generated');
    }
  } catch (error) {
    logger.debug(error);
    throw error;
  }
}
const MAX_TOKENS = 3000
async function getContent(pdfBuffer, logger) {
  // let outputDirectory = '/tmp'
  let pages = await pdfParse(pdfBuffer, {pagerender: renderPage.bind(this)})
  let len = pages.length
logger.debug(`docUtils.pdfParse: number of PDF pages: ${len}`)
logger.debug(`docUtils.pdfParse: pages`, JSON.stringify(pages))

  for (let i=len-1; i>=0; i--)
    if (!pages[i].trim().length)
      pages.splice(i, 1)
  len = pages.length
  if (len)
    return pages

  const readPdf = await PDFDocument.load(pdfBuffer);
  const { length } = readPdf.getPages();
  pages = []
  for (let i = 0, n = length; i < n; i += 1) {
    const writePdf = await PDFDocument.create();
    const [page] = await writePdf.copyPages(readPdf, [i]);
    writePdf.addPage(page);
    const bytes = await writePdf.save();

    pages.push(bytes)
  }
logger.debug(`docUtils.pdfParse: number of PDF pages: ${len}`)

  return pages.length > 1 ? pages : [pdfBuffer]
}

export function combinePages(pages) {
  let newPages = []
  let cnt = 0
  let start = 0
  let len = pages.length
  let newPage = ''
  for (let i=0; i<len; i++) {
    let pageTokens = countTokens(pages[i])
    cnt += pageTokens
    if (cnt < MAX_TOKENS) {
      newPage += pages[i]
      if (i === len - 1)
        newPages.push(newPage)
      continue
    }
    newPages.push(newPage)
    newPage = pages[i]
    start = i
    cnt = pageTokens
  }
  return newPages
}

async function renderPage(pageData) {
  console.log('in renderPage', pageData)
  //check documents https://mozilla.github.io/pdf.js/
  //ret.text = ret.text ? ret.text : "";

  let render_options = {
      //replaces all occurrences of whitespace with standard spaces (0x20). The default value is `false`.
      normalizeWhitespace: false,
      //do not attempt to combine same line TextItem's. The default value is `false`.
      disableCombineTextItems: false
  }

  let textContent = await pageData.getTextContent(render_options)
  // if (!textContent.items.length) {
  //   let viewport = pageData.getViewport({scale: 1})
  //   const canvas = createCanvas(viewport.width, viewport.height);
  //   const context = canvas.getContext('2d');
  //   const renderContext = {
  //     canvasContext: context,
  //     viewport: viewport,
  //     canvasFactory: {
  //       create: function (width, height) {
  //         return createCanvas(width, height);
  //       },
  //     },
  //   };
  //   await pageData.render(renderContext).promise;
  //   return canvas.toBuffer('raw');
  // }

  let lastY, text = '';
  //https://github.com/mozilla/pdf.js/issues/8963
  //https://github.com/mozilla/pdf.js/issues/2140
  //https://gist.github.com/hubgit/600ec0c224481e910d2a0f883a7b98e3
  //https://gist.github.com/hubgit/600ec0c224481e910d2a0f883a7b98e3
  for (let item of textContent.items) {
    if (lastY == item.transform[5] || !lastY)
      text += ' ' + item.str;
    else
      text += '\n' + item.str;

    lastY = item.transform[5];
  }
  if (!text.length)
    return ''
  return `${text}`;
}

const {encode} = require('gpt-3-encoder');

export function countTokens(text) {
  const tokens = encode(text);
  return tokens.length;
}

// export async function splitTextIntoChunks(text, logger) {
//   const chunks = [];

//   let currentChunk = '';
//   let tokens = 0;

//   const paragraphs = text.split(/\n\n+/);

//   for (const paragraph of paragraphs) {
//     const paragraphTokens = countTokens(paragraph);
//     console.log("patagraph tokens: ", paragraphTokens);

//     if (tokens + paragraphTokens > 2000) {
//       const sentences = paragraph.split(/[.!?]+/);

//       for (const sentence of sentences) {
//         const sentenceTokens = countTokens(sentence);

//         if (tokens + sentenceTokens > 2000) {
//           chunks.push(currentChunk);
//           console.log('Chunk created (sentence split):', currentChunk);
//           console.log("");
//           currentChunk = sentence;
//           tokens = sentenceTokens;
//         } else {
//           currentChunk += sentence;
//           tokens += sentenceTokens;
//         }
//       }
//     } else {
//       currentChunk += paragraph;
//       tokens += paragraphTokens;
//     }
//   }

//   if (currentChunk) {
//     chunks.push(currentChunk);
//     console.log('Chunk created:', currentChunk);
//     console.log("");
//   }

//   return chunks;
// }

// export async function checkAndResizeResizeImage (dataUrl, logger) {
//   let pref = dataUrl.substring(0, dataUrl.indexOf(',') + 1)

//   let buffer: any = DataURI.decode(dataUrl)
//   let buf
//   let isPDF = pref.indexOf('application/pdf') !== -1
//   if (isPDF) {
//   // debugger
//     try {
//       buf = await convertPdfToPng(buffer, logger)
//     } catch (err) {
//       logger.error('document-ocr failed', err)
//       return {}
//     }
//   }
//   else
//     buf = DataURI.decode(dataUrl)

//   return await imageResize({buf, pref, logger, isPDF})
// }
// async function imageResize ({buf, pref, logger, maxWidth, isPDF}:{buf:Buffer, pref: string, maxWidth?:number, logger: Logger, isPDF?: boolean}) {
//   let isTooBig = buf.length > MAX_FILE_SIZE
//   if (!isTooBig) {
//     if (!isPDF)
//       return buf
//   }

//   let dimensions: any = sizeof(buf);
//   let currentWidth: number = dimensions.width
//   let currentHeight: number = dimensions.height
//   logger.debug(`prefillWithChatGPT image original w=${currentWidth}' h=${currentHeight}`)
//   let biggest = currentWidth > currentHeight ? currentWidth : currentHeight
//   if (!maxWidth)
//     maxWidth = MAX_WIDTH
//   let coef: number = maxWidth / biggest
//   // Need to resize image from PDF  at least once
//   if (isPDF && !isTooBig && coef >= 1)
//     coef = 0.9

//   if (currentWidth < currentHeight) { // rotate
//     let resizedBuf: any
//     let width: number = currentHeight
//     let height: number = currentWidth
//     if (coef < 1) { // also resize
//       width = Math.round(currentHeight * coef)
//       height = Math.round(currentWidth * coef)
//       try {
//         // resizedBuf = await sharp(buf, {sequentialRead: true}).rotate(-90).resize(width, height).toFile('/tmp/f.png')
//         resizedBuf = await sharp(buf, {sequentialRead: true}).rotate(-90).resize(width, height).toBuffer()
//         // const rotatedImage = await sharp(buf, {sequentialRead: true}).rotate(-90).toBuffer();
//         // resizedBuf = await sharp(rotatedImage).resize(width, height).toBuffer();
//       } catch (err) {
//         logger.debug('error rotating and resizing image', err)
//         return
//       }
//       logger.debug(`prefillWithChatGPT image resized and rotated w=${width}' h=${height}`)
//     }
//     else {
//       try {
//         // resizedBuf = await sharp(buf, {sequentialRead: true}).rotate(-90).toBuffer()
//         resizedBuf = await sharp(buf).rotate(-90).toBuffer()
//       } catch (err) {
//         logger.debug('error rotating image', err)
//         return
//       }
//       logger.debug(`prefillWithChatGPT image rotated w=${width}' h=${height}`)
//     }
//     let newDataUrl = pref + resizedBuf.toString('base64')
//     buf = DataURI.decode(newDataUrl)
//     return imageResize({buf, pref, logger, maxWidth: maxWidth / 2})
//   }
//   if (coef < 1) {
//     let width = Math.round(currentWidth * coef)
//     let height = Math.round(currentHeight * coef)
//     let resizedBuf = await sharp(buf).resize(width, height).toBuffer()
//     let newDataUrl = pref + resizedBuf.toString('base64')
//     logger.debug(`prefillWithChatGPT image resized w=${width}' h=${height}`)
//     buf = DataURI.decode(newDataUrl)
//     return imageResize({buf, pref, logger, maxWidth: maxWidth / 2})
//   }
//   logger.debug(`prefillWithChatGPT image no change`)
//   return buf
// }
