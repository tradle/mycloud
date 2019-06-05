import _ from 'lodash'
// import validateResource from '@tradle/validate-resource'
import { TYPE, PERMALINK, LINK } from '@tradle/constants'
import DataURI from 'strong-data-uri'

import AWS from 'aws-sdk'

import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

import {
  Bot,
  CreatePlugin,
  ValidatePluginConf,
  Applications,
  IConfComponents,
  IPluginLifecycleMethods,
  Logger
} from '../types'
import Errors from '../../errors'

import Diff from 'text-diff'

const FORM_ID = 'tradle.Form'

// export const name = 'document-ocr'

type DocumentOcrOpts = {
  bot: Bot
  conf: IDocumentOcrConf
  applications: Applications
  logger: Logger
}
interface IDocumentOcrConf {
  [productModelId: string]: {}
}
const data = {
  companyName: 'The Walt Disney Company',
  registrationNumber: '2528877',
  registrationDate: 806904000000
}

// const myconfig = {
//   "legalEntity_us_de": {
//     "map": {
//       "^": "companyName",
//       "^^": "streetAddress",
//       "^^^": "registrationNumber",
//       "^_^^^": "registrationDate_Year",
//       "^^_^^": "registrationDate_Month",
//       "^^^^": "registrationDate_Day"
//     },
//     "templates": [
//       "Delaware\nPAGE 1\nThe First State\nI, JEFFREY W. BULLOCK, SECRETARY OF STATE OF THE STATE OF\nDELAWARE, DO HEREBY CERTIFY THE ATTACHED IS A TRUE AND CORRECT\nCOPY OF THE CERTIFICATE OF INCORPORATION OF \"^\",\nFILED IN THIS OFFICE ON THE ^^^^ DAY OF ^^_^^,A. D.^_^^^, AT ^^^^^\nA FILED COPY OF THIS CERTIFICATE HAS BEEN FORWARDED THE\nNEW CASTLE COUNTY RECORDER OF DEEDS.\nARYOF\nGE\nJeffrey W. Bullock, Secretary of State\n^^^ ^^^^^^^\nAUTHENTTCATION ^^^^^^^\nDATE: ^^^^^^\n^^^\nLAWA\nYou may verify this certificate online\nat corp. laware.gov/authver shtml\n\n",
//       "s\nSTATE OF NEW JERSEY\nBUSINESS REGISTRATION CERTIFICATE\nDEPARTMENT OF TREASURY/\nDIVISION OF REVENUE\nPO BOX 252\nTRENTON, N J 08646-0252\nTAXPAYER NAME:\nTRADE NAME:\n^\nADDRESS:\nSEQUENCE NUMBER:\n^^\n^^^\n^^\nISSUANCE DATE:\nEFFECTIVE DATE:\n^^^^\n^^^^^\nDirector\nNew Jersey Division ot Revenue\n\n"
//     ]
//   }
// }
export class DocumentOcrAPI {
  private bot: Bot
  private conf: IDocumentOcrConf
  private applications: Applications
  private logger: Logger
  constructor({ bot, conf, applications, logger }: DocumentOcrOpts) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
    this.logger = logger
  }
  public async ocr(payload, prop, myConfig) {
    await this.bot.resolveEmbeds(payload)

    // Form now only 1 doc will be processed
    let base64
    if (Array.isArray(payload[prop])) base64 = payload[prop][0].url
    else base64 = payload[prop].url

    let buffer: Buffer = DataURI.decode(base64)

    // let accessKeyId = ''
    // let secretAccessKey = ''
    // let region = payload.region
    let textract = new AWS.Textract({ apiVersion: '2018-06-27' }) //, accessKeyId, secretAccessKey, region })

    let params = {
      Document: {
        /* required */
        Bytes: buffer
      }
    }

    try {
      let apiResponse: AWS.Textract.DetectDocumentTextResponse = await textract
        .detectDocumentText(params)
        .promise()
      //  apiResponse has to be json object
      let response: any = this.extractMap(apiResponse, myConfig)

      // need to convert string date into ms -- hack

      convertDateInWords(response) // response.registrationDate
      return response
    } catch (err) {
      debugger
      this.logger.error('textract analyzeDocument failed', err)
    }
    return {}
  }

  public lineBlocks = blocks => {
    let lineBlocks = []
    let start = false
    for (let block of blocks) {
      if (block.BlockType == 'PAGE') {
        if (start == false) start = true
        else break
      } else if (block.BlockType == 'LINE') {
        lineBlocks.push(block)
      }
    }
    lineBlocks.sort(this.compare)
    return lineBlocks
  }
  public compare = (block1, block2) => {
    if (block1.Geometry.BoundingBox.Top > block2.Geometry.BoundingBox.Top) return 1
    return -1
  }

  public fullText = lines => {
    let txt = ''
    for (let block of lines) {
      txt += block.Text + '\n'
    }
    return txt
  }

  public firstPageTxt = apiResponse => {
    let response = apiResponse //JSON.parse(rawdata);
    let blocks = response.Blocks
    let lines = this.lineBlocks(blocks)
    let txt = this.fullText(lines)
    return txt
  }

  public extractMap = (apiResponse, myconfig) => {
    let input = this.firstPageTxt(apiResponse)

    let diff = new Diff()

    let min = 100000000
    let textDiff
    for (let one of myconfig.templates) {
      let textArr = diff.main(one, input)
      if (min > textArr.length) {
        min = textArr.length
        textDiff = textArr
      }
    }
    //console.log(textDiff)
    //console.log('number of diffs', min)
    if (min > 70) {
      this.logger.debug('in input ' + apiResponse + ' could not find anything')
      this.logger.debug('no template matches, number of differences are too many: ' + min)
      return {}
    }

    let found = false
    let key
    let map = {}
    for (let part of textDiff) {
      if (part[0] == 0) {
        found = false
      } else if (part[0] == -1 && part[1].includes('^')) {
        found = true
        key = part[1]
      } else if (found && part[0] == 1) {
        found = false
        let value = map[key]
        if (value) {
          map[key] = value + '\n' + part[1].trim()
        } else {
          map[key] = part[1].trim()
        }
      }
    }
    let output = {}
    for (const key in map) {
      let value = map[key]
      let newkey = myconfig.map[key]
      if (newkey) output[newkey] = value
    }
    this.logger.debug('in input ' + apiResponse + ' found')
    this.logger.debug(JSON.stringify(output, null, 2))
    return output
  }
}

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const documentOcrAPI = new DocumentOcrAPI({ bot, conf, applications, logger })
  // debugger
  const plugin: IPluginLifecycleMethods = {
    // check if auto-approve ifvapplication Legal entity product was submitted
    async [`onmessage:${FORM_ID}`](req) {
      const { user, application, payload } = req
      if (!application) return
      const productId = application.requestFor
      const formConf = conf[productId] && conf[productId][payload[TYPE]]
      if (!formConf) return
      const prop = formConf.property
      if (!prop || !payload[prop]) return
      // debugger
      // Check if this doc was already processed
      if (payload._prevlink && payload.registrationDate && payload.photos) {
        let dbRes = await bot.objects.get(payload._prevlink)
        if (dbRes && dbRes.photos && dbRes.photos.length === payload.photos.length) {
          let dbPhotos = Array.isArray(dbRes.photos) ? dbRes.photos : [dbRes.photos]
          let payloadPhotos = Array.isArray(payload.photos) ? payload.photos : [payload.photos]
          let same = true
          for (let i = 0; i < dbPhotos.length && same; i++) {
            let url = dbPhotos[i].url
            let idx = payloadPhotos.findIndex(r => r.url === url)
            same = idx !== -1
          }
          if (same) return
        }
      }
      let confId = `${payload.country.id
        .split('_')[1]
        .toLowerCase()}_${payload.region.toLowerCase()}`
      let prefill
      try {
        prefill = await documentOcrAPI.ocr(payload, prop, formConf[confId])
        prefill = sanitize(prefill).sanitized
      } catch (err) {}
      const payloadClone = _.cloneDeep(payload)
      payloadClone[PERMALINK] = payloadClone._permalink
      payloadClone[LINK] = payloadClone._link

      _.extend(payloadClone, prefill)
      // debugger
      let formError: any = {
        req,
        user,
        application
        // item: payload,
      }
      if (prefill) {
        formError.details = {
          prefill: payloadClone,
          message: `Please review and correct the data below`
        }
      } else
        formError.details = {
          message: `Please fill out the form`
        }
      let requestConfirmationCode
      try {
        requestConfirmationCode = await applications.requestEdit(formError)
      } catch (err) {
        debugger
      }
    }
  }

  return { plugin }
}
export const validateConf: ValidatePluginConf = async ({
  bot,
  conf,
  pluginConf
}: {
  bot: Bot
  conf: IConfComponents
  pluginConf: IDocumentOcrConf
}) => {
  const { models } = bot
  Object.keys(pluginConf).forEach(productModelId => {
    const productModel = models[productModelId]
    if (!productModel) {
      throw new Errors.InvalidInput(`model not found: ${productModelId}`)
    }

    if (productModel.subClassOf !== 'tradle.FinancialProduct') {
      throw new Errors.InvalidInput(`expected a product model: ${productModelId}`)
    }

    const forms = pluginConf[productModelId]

    for (let formModelId in forms) {
      const formModel = models[formModelId]
      if (!formModel) {
        throw new Errors.InvalidInput(`model not found: ${formModelId}`)
      }

      if (formModel.subClassOf !== 'tradle.Form' && formModel.subClassOf !== 'tradle.MyProduct') {
        throw new Errors.InvalidInput(
          `expected ${productModelId} to map to subclasses of tradle.Form or tradle.MyProduct`
        )
      }
      const prop = forms[formModelId].property
      if (!formModel.properties[prop]) {
        throw new Errors.InvalidInput(`property ${prop} was not found in ${formModelId}`)
      }
    }
  })
}
// let input = {"companyName":"TRADLE, INC.",
//              "registrationDate_DAY":"TWENTY-NINTH",
// "registrationDate_MONTH":"APRIL",
// "registrationDate_YEAR":"2014",
// "registrationNumber":"5524712"}

function daytonum(day) {
  const daymap = {
    first: '01',
    second: '02',
    third: '03',
    fourth: '04',
    fifth: '05',
    sixth: '06',
    seventh: '07',
    eighth: '08',
    ninth: '09',
    tenth: '10',
    eleventh: '11',
    twelfth: '12',
    thirteenth: '13',
    fourteenth: '14',
    fifteenth: '15',
    sixteenth: '16',
    seventeenth: '17',
    eighteenth: '18',
    nineteenth: '19',
    twentieth: '20',
    'twenty-first': '21',
    'twenty-second': '22',
    'twenty-third': '23',
    'twenty-fourth': '24',
    'twenty-fifth': '25',
    'twenty-sixth': '26',
    'twenty-seventh': '27',
    'twenty-eighth': '28',
    'twenty-ninth': '29',
    thirtieth: '30',
    'thirty-first': '31'
  }
  return daymap[day.toLowerCase()]
}

function monthtonum(month) {
  const monthmap = {
    january: '01',
    february: '02',
    march: '03',
    april: '04',
    may: '05',
    june: '06',
    july: '07',
    august: '08',
    september: '09',
    october: '10',
    november: '11',
    december: '12'
  }
  return monthmap[month.toLowerCase()]
}

function convertDateInWords(input) {
  if (input.registrationDate_Day && input.registrationDate_Month && input.registrationDate_Year) {
    let d = Date.parse(
      input.registrationDate_Year +
        '-' +
        monthtonum(input.registrationDate_Month) +
        '-' +
        daytonum(input.registrationDate_Day)
    )

    input.registrationDate = d
    delete input.registrationDate_Year
    delete input.registrationDate_Month
    delete input.registrationDate_Day
  }
}

// convertDateInWords(input)
// console.log(input)
