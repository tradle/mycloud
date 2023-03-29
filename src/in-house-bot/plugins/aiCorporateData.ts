import _ from 'lodash'
import { execSync } from 'child_process'

import { TYPE } from '@tradle/constants'
import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils
import { getChatGPTMessage } from '../openAiInterface'

import {
  Bot,
  CreatePlugin,
  ValidatePluginConf,
  Applications,
  IPluginLifecycleMethods,
  Logger,
  IPBReq
} from '../types'
import { getEnumValueId, getStatusMessageForCheck } from '../utils'
import { normalizeResponse, checkAndResizeResizeImage, doTextract } from '../docUtils'

const PROVIDER = 'ChatGPT'

const LEGAL_ENTITY = 'tradle.legal.LegalEntity'
const SENIOR_MANAGER_POSITION = 'tradle.SeniorManagerPosition'
const COUNTRY = 'tradle.Country'
const AI_CORPORATION_CHECK = 'tradle.AICorporationCheck'
const AI_ARTICLES_OF_ASSOCIATION_CHECK = 'tradle.AiArticlesOfAssociationCheck'
const TYPE_OF_CP = 'tradle.legal.TypeOfControllingEntity'
const ASPECTS = 'Reading document with AI'
const PROP_TO_CHECK = {
  companyFormationDocument: AI_CORPORATION_CHECK,
  articlesOfAssociationDocument: AI_ARTICLES_OF_ASSOCIATION_CHECK
}
const MAPS = {
  articlesOfAssociationDocument: {
    properties: {
      companyName: '',
      state: '',
      positions: [{
        firstName: '',
        lastName: '',
        jobTitle: []  
      }],
      shares: [{
        firstName: '',
        lastName: '',
        numberOfShares: '',
        // purchasePrice: '',      
      }],
      // totalShares: '',
      // percentageOfShares: ''
    },
    additionalPrompt: '# Convert numberOfShares to numbers.',
    // additionalPrompt: "# To calculate percentage of shares for each shareholder wait till all of the document is read, first calculate the total number of shares by adding up the number of shares purchased by all shareholders, \nand then calculate the percentage of shares purchased by each shareholder \nbased on the total number of shares.",
    // enumProperties: {
    //   jobTitle: 'tradle.SeniorManagerPosition'
    // },
    moneyProperties: {
      purchasePrice: ""
    }
  }
}
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
  public async exec({payload, prop, req, check}) {
    // Form now only 1 doc will be processed
    let base64
    if (Array.isArray(payload[prop])) base64 = payload[prop][0].url
    else base64 = payload[prop].url
   
    let image = await checkAndResizeResizeImage(base64, this.logger)
    let message
    this.logger.debug(`Textract document for property: ${prop}`)

    try {
      ({ message} = await doTextract(image, this.logger))
    } catch (err) {
      this.logger.debug('Textract error', err)
      return
    }
    let params:any = {
      req, 
      bot: this.bot, 
      conf: this.botConf.bot, 
      message: message.slice(1, message.length - 1)
    }
    const {models} = this.bot
    let model = models[payload[ TYPE]]

    // let map = this.conf.map
    // if (map && map[payload[TYPE]])
    // if (MAPS[payload[TYPE]])
    //   model = models[MAPS[payload[TYPE]]]
    let otherProperties = MAPS[prop]
    if (otherProperties)
      params.otherProperties = otherProperties
    params.model = model

    try {          
      this.logger.debug(`ChatGPT document for property: ${prop}`)

      let data = await getChatGPTMessage(params)
      params.message = ''
      // let data1 = await getChatGPTMessage(params)
      if (!data) {
        debugger
        return
      }
      let lastBracesIdx = data.lastIndexOf('}')
      if (lastBracesIdx === -1) {
        this.logger.debug('ChatGPT response does not have JSON', data)
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
      return otherProperties 
            ? mapToCpProperties(response, prop, models) 
            : normalizeResponse({response, model, models})
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
    async onmessage(req:IPBReq) {
      const { user, application, payload } = req
      // debugger
      if (!application) return
      if (payload[TYPE] !== LEGAL_ENTITY) return
      
      // if (payload.registrationNumber) return

      if (!payload.companyFormationDocument || !payload.articlesOfAssociationDocument) return
      let changed = [] //'articlesOfAssociationDocument', 'companyFormationDocument']
      const { models } = bot
      let dbRes
      if (payload._prevlink) {  //  payload.registrationNumber) {
        dbRes = await bot.objects.get(payload._prevlink) 
        if (checkIfDocumentChanged({dbRes, payload, property: 'companyFormationDocument', models}))
          changed.push('companyFormationDocument')
        else
          logger.debug(`Document for "companyFormationDocument" didn't change`)  
        if (checkIfDocumentChanged({dbRes, payload, property: 'articlesOfAssociationDocument', models}))
          changed.push('articlesOfAssociationDocument')
          else
          logger.debug(`Document for "articlesOfAssociationDocument" didn't change`)  
      }
      else {
        changed.push('companyFormationDocument')
        changed.push('articlesOfAssociationDocument')
      }
      if (!changed.length) return
      await bot.resolveEmbeds(payload)

      for (let i=0; i<changed.length; i++) {
        let prop = changed[i]
        let check
        try {
          logger.debug(`reading document for property: ${prop}`)
          let response = await prefillWithChatGPT.exec({payload, prop, req, check})
          if (!response) {
            logger.debug(`no response for document set in property: ${prop}`)
            debugger
            // return
          }
          check = {
            [TYPE]: PROP_TO_CHECK[prop],
            status: response ? 'pass' : 'fail',
            provider: PROVIDER,
            application,
            dateChecked: Date.now(),
            // shareUrl: url,
            aspects: ASPECTS,
            form: payload,
          }
          check.message = getStatusMessageForCheck({models, check})
          // HACK
          if (response) {
            if (response.registrationNumber && response.country && getEnumValueId({ model: models[COUNTRY], value: response.country }) === 'US') 
              response.registrationNumber = response.registrationNumber.split(' ')[0]            
            check.rawData = sanitize(response).sanitized
          }
          // check = sanitize(check).sanitized
          check = await applications.createCheck(check, req)
        } catch (err) {
          debugger
        }
      }
    },
  }
  return { 
    plugin 
  }
}

function checkIfDocumentChanged({dbRes, payload, property, models}) {
  let pType = models[payload[TYPE]].properties[property].type
  let isArray = pType === 'array'
  let maybeNotChanged
  if (dbRes  &&  dbRes[property]) {
    if (isArray)
      maybeNotChanged = dbRes[property].length === payload[property].length
    else  
      maybeNotChanged = dbRes[property].url === payload[property].url 
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
    if (same) return false
  }
  return true
}

function mapToCpProperties(response, property, models) {
  // let { properties } = models[LEGAL_ENTITY_CP]
  let { shares, positions } = response
  if (!shares.length  &&  !positions.length) return
  let people = []
  let totalShares = shares.reduce((a, b) => {
    return a + b.numberOfShares
  }, 0)  
  let smEnum = models[SENIOR_MANAGER_POSITION].enum
  let typeOfControllingEntity = models[TYPE_OF_CP].enum.find(e => e.id === 'person')
  if (JSON.stringify(positions) !== JSON.stringify(MAPS[property].properties.positions) ||
      JSON.stringify(shares) !== JSON.stringify(MAPS[property].properties.shares)) {
    positions.forEach(p => {
      let { firstName, lastName, jobTitle } = p
      let obj:any = {
        firstName,
        lastName     
      }
      let jobTitleL = jobTitle.map(jt => jt.toLowerCase())
      let pIdx = smEnum.findIndex(e => {
        let idx = jobTitleL.indexOf(e.title.toLowerCase())
        if (idx === -1) return false
        jobTitle.splice(idx, 1)
        return true        
      })
      if (pIdx !== -1) {
        let position = smEnum[pIdx]
        obj.isSeniorManager = true
        obj.seniorManagerPosition = {
          id: `${SENIOR_MANAGER_POSITION}_${position.id}`,
          title: position.title
        }
      }
      if (jobTitle.length)
        obj.position = jobTitle.join(', ')      

      let sh = shares.find(sh => sh.firstName.toLowerCase() === p.firstName.toLowerCase() && sh.lastName.toLowerCase() === p.lastName.toLowerCase())
      if (sh) 
        obj.percentageOfOwnership = Math.round(sh.numberOfShares/totalShares * 100 * 100)/100
      obj.typeOfControllingEntity = {
        id: `${TYPE_OF_CP}_${typeOfControllingEntity.id}`,
        title: typeOfControllingEntity.title
      }
      people.push(obj)
    })
    shares.forEach(sh => {
      let { firstName, lastName, numberOfShares } = sh
      let person = people.find(p => firstName === p.firstName && lastName === p.lastName)    
      if (person) return
      people.push({
        firstName,
        lastName,
        percentageOfShares: Math.round(numberOfShares/totalShares * 100 * 100)/100
      })
    })
  }
  return people
}
