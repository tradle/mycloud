import _ from 'lodash'
// import validateResource from '@tradle/validate-resource'
import { TYPE, PERMALINK, LINK } from '@tradle/constants'
import DataURI from 'strong-data-uri'
import { getLatestForms } from '../utils'
import AWS from 'aws-sdk'
import Embed from '@tradle/embed'
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
import { String } from 'aws-sdk/clients/cognitosync'

const FORM_ID = 'tradle.Form'
const LEGAL_ENTITY = 'tradle.legal.LegalEntity'
const CERTIFICATE_OF_INC = 'tradle.legal.CertificateOfIncorporation'
// export const name = 'document-ocr'

import telcoResponse from '../../../mx-telco-apiResponse'
const testMap = {
  'tradle.PhoneBill': telcoResponse
}

type DocumentOcrOpts = {
  bot: Bot
  conf: IDocumentOcrConf
  applications: Applications
  logger: Logger
}
interface IDocumentOcrConf {
  [productModelId: string]: {}
}
// const data = {
//   companyName: 'The Walt Disney Company',
//   registrationNumber: '2528877',
//   registrationDate: 806904000000
// }

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
    let object: any = Embed.getEmbeds(payload)
    let bucket: string
    let key: string
    if (Array.isArray(object)) {
      bucket = object[0].bucket
      key = object[0].key
    } else {
      bucket = object.bucket
      key = object.key
    }
    await this.bot.resolveEmbeds(payload)
    // Form now only 1 doc will be processed
    let base64
    if (Array.isArray(payload[prop])) base64 = payload[prop][0].url
    else base64 = payload[prop].url

    let buffer: any = DataURI.decode(base64)
    // debugger
    let syncMode = true
    if (buffer.mimetype === 'application/pdf') {
      syncMode = false
    }

    let accessKeyId = ''
    let secretAccessKey = ''
    let region = 'us-east-1'
    let textract = new AWS.Textract({ apiVersion: '2018-06-27', accessKeyId, secretAccessKey, region })

    let isTest = myConfig.isTest && testMap[payload[TYPE]] !== null

    if (syncMode) {
      let params = {
        Document: {
          /* required */
          Bytes: buffer
        }
      }
      try {
        let apiResponse
        if (isTest) apiResponse = testMap[payload[TYPE]]
        else apiResponse = await textract.detectDocumentText(params).promise()
        //  apiResponse has to be json object
        let response: any = this.extractMap(apiResponse, myConfig)

        // need to convert string date into ms -- hack
        let map: any = Object.values(myConfig.map)
        let dateProp = map.find(p => p.indexOf('_day') !== -1)
        if (dateProp) dateProp = dateProp.split('_')[0]
        convertDateInWords(response, dateProp) // response.registrationDate
        return response
      } catch (err) {
        debugger
        this.logger.error('textract detectDocumentText failed', err)
      }
      return {}
    } else {
      let params1 = {
        DocumentLocation: {
          /* required */
          S3Object: {
            Bucket: bucket,
            Name: key
          }
        },
        ClientRequestToken: key.replace('.', '-')
      }

      let data
      let params2
      if (!isTest) {
        try {
          data = await textract.startDocumentTextDetection(params1).promise()
        } catch (err) {
          debugger
          this.logger.error('textract startDocumentTextDetection failed', err)
          return {}
        }
        await this.sleep(15000)
        params2 = {
          JobId: data.JobId /* required */
        }
      }
      let time = 0
      let apiResponse
      while (true) {
        try {
          time++
          if (isTest) apiResponse = testMap[payload[TYPE]]
          else apiResponse = await textract.getDocumentTextDetection(params2).promise()
          if (apiResponse.JobStatus == 'SUCCEEDED') {
            break
          } else if (time >= 25) {
            this.logger.error('textract documentTextDetection took too long')
          } else {
            await this.sleep(4000)
          }
        } catch (err) {
          this.logger.error('textract getDocumentTextDetection failed', err)
          return {}
        }
      }
      //  apiResponse has to be json object
      debugger
      let response: any = this.extractMap(apiResponse, myConfig)

      // need to convert string date into ms -- hack
      let map: any = Object.values(myConfig.map)

      let dateProp = map.find(p => p.indexOf('_day') !== -1)
      if (dateProp) dateProp = dateProp.split('_')[0]
      convertDateInWords(response, dateProp) // response.registrationDate
      return response
    }
  }

  public sleep = async (ms: number) => {
    await this._sleep(ms)
  }

  public _sleep = (ms: number) => {
    return new Promise(resolve => setTimeout(resolve, ms))
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
    if (block1.Geometry.BoundingBox.Top == block2.Geometry.BoundingBox.Top) return 0
    return -1
  }

  public match = (template, blocks) => {
    let markerText = template.marker
    let markerBox = template.BoundingBox

    for (let block of blocks) {
      let blockBox = block.Geometry.BoundingBox
      if (blockBox.Top > markerBox.Top + markerBox.Height + 0.05)
        return false
      //console.log(block.Text)
      if (block.Text === markerText) {
        if (this.isInside(blockBox, markerBox)) {
          return true
        }
      }
    }
  }

  public isInside = (box, bigBox) => {
    return box.Top > bigBox.Top - 0.05 &&
      box.Left > bigBox.Left - 0.05 &&
      box.Width < bigBox.Width + 0.1 &&
      box.Height < bigBox.Height + 0.1
  }

  public fullText = (lines, multiline) => {
    let txt = ''
    let delim = multiline ? '\n' : ' '
    for (let block of lines) {
      txt += block.Text + delim
    }
    return txt
  }

  public extractMap = (apiResponse, myconfig) => {
    let blocks = apiResponse['Blocks']
    let lines = this.lineBlocks(blocks)
    let notMatched = true
    for (let template of myconfig.templates) {
      if (this.match(template, lines)) {
        return this.extract(apiResponse, template, lines, myconfig)
      }
    }
  }

  public extract = (apiResponse, template, lines, myconfig) => {
    let input = this.fullText(lines, template.multiline)

    var diff = new Diff();
    let textDiff = diff.main(template.text, input);

    // console.log(textDiff)
    let found = false
    let key
    let map = {}
    for (let part of textDiff) {
      if (part[0] == 0)
        found = false;
      else if (part[0] == -1 && part[1].includes('^')) {
        found = true
        key = part[1]
      }
      else if (found && part[0] == 1) {
        found = false
        let value = map[key]
        if (value) {
          map[key] = value + '\n' + part[1].trim()
        }
        else {
          map[key] = part[1].trim()
        }
        this.logger.debug(`${key}  ---> ${map[key]}`)
      }
    }
    let output = {}
    for (const key in map) {
      let value = map[key]
      let newkey = myconfig.map[key]
      if (newkey)
        output[newkey] = value
    }
    this.logger.debug('in input ' + apiResponse + ' found')
    this.logger.debug(JSON.stringify(output, null, 2))
    return output
  }
  if(notMatched) {
    this.logger.debug('marker has not matched')
    return {}
  }

}


export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const documentOcrAPI = new DocumentOcrAPI({ bot, conf, applications, logger })
  // debugger
  const plugin: IPluginLifecycleMethods = {
    async onFormsCollected({ req }) {
      const { user, application, payload } = req
      if (!application) return

      const productId = application.requestFor
      const formConf = conf[productId]
      if (!formConf) return
      debugger
      const latestForms = getLatestForms(application)
      const stub = latestForms.find(form => form.type === LEGAL_ENTITY)
      if (stub) {
        await this.handleLe({ stub, latestForms, req })
        return
      }
      // const piStub = latestForms.find(form => form.type === PERSONAL_INFO)
      // if (piStub) {
      //   debugger
      // }
    },
    async handleLe({ stub, latestForms, req }) {
      let le = await bot.objects.get(stub.link)
      if (le.document) return

      const { user, application, payload } = req

      const certStub = latestForms.find(form => form.type === CERTIFICATE_OF_INC)
      if (!certStub) return
      let cert = await bot.objects.get(certStub.link)

      const { country, companyName, registrationDate, registrationNumber, region } = cert
      // let prefill: any = { [TYPE]: LEGAL_ENTITY }
      if (country && le.country) return

      const { _link, _permalink } = le
      let prefill = _.cloneDeep(le)
      prefill._r = _permalink
      prefill._c = _link
      delete prefill._permalink
      delete prefill._link

      _.extend(prefill, { country, companyName, registrationDate, registrationNumber })
      prefill.document = _.pick(cert, ['_link', '_permalink', '_t'])
      prefill.document._displayName = cert.companyName
      if (region) prefill.region = region
      try {
        prefill = sanitize(prefill).sanitized
      } catch (err) {
        debugger
      }

      let formError: any = {
        req,
        user,
        application,
        details: {
          prefill,
          message: `Please review and confirm`
        }
        // item: payload,
      }
      try {
        await applications.requestEdit(formError)
      } catch (err) {
        debugger
      }
    },
    // async [`onmessage:${FORM_ID}`](req) {
    async validateForm({ req }) {
      const { user, application, payload } = req
      debugger
      if (!application) return
      const productId = application.requestFor
      const formConf = conf[productId] && conf[productId][payload[TYPE]]
      if (!formConf) return
      const { property } = formConf
      if (!property || !payload[property]) return
      // debugger
      // Check if this doc was already processed
      let registrationDateProp = 'registrationDate'
      if (payload._prevlink && payload[registrationDateProp] && payload[property]) {
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
      let country = payload.country
      if (!country) return
      let reg = payload.region
      if (reg) {
        if (typeof reg === 'object') reg = reg.id.split('_')[1]
        reg = reg.toLowerCase()
      }
      let confId = `${country.id.split('_')[1].toLowerCase()}${(reg && '_' + reg) || ''}`
      let prefill
      try {
        prefill = await documentOcrAPI.ocr(payload, property, formConf[confId])
        prefill = sanitize(prefill).sanitized
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
      try {
        return await applications.requestEdit(formError)
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

      if (
        !isSubClassOf('tradle.Form', formModel, bot.models) &&
        formModel.subClassOf !== 'tradle.MyProduct'
      ) {
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
function isSubClassOf(subType, formModel, models) {
  const sub = formModel.subClassOf
  if (sub === subType) return true
  if (sub && models[sub].abstract) return isSubClassOf(subType, models[sub], models)
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

function convertDateInWords(input, dateProp) {
  if (dateProp == 'billDate') {
    let day = dateProp + '_day'
    let mon = dateProp + '_month'
    let year = dateProp + '_year'
    if (input[day] && input[mon] && input[year]) {
      let date = input[day] + ' ' + input[mon] + ' ' + input[year]
      let d = Date.parse(date)
      input[dateProp] = d
    }
    delete input[year]
    delete input[mon]
    delete input[day]
  }
  else {
    let day = dateProp + '_Day'
    let mon = dateProp + '_Month'
    let year = dateProp + 'Year'
    if (input[day] && input[mon] && input[year]) {
      let d = Date.parse(input[year] + '-' + monthtonum(input[mon]) + '-' + daytonum(input[day]))
      input[dateProp] = d
    }
    delete input[year]
    delete input[mon]
    delete input[day]
  }
}

// convertDateInWords(input)
// console.log(input)