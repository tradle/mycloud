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
  Applications,
  IPluginLifecycleMethods,
  Logger,
  IPBReq
} from '../types'
import { getEnumValueId, getStatusMessageForCheck } from '../utils'
import { normalizeResponse, getPDFContent, doTextract, combinePages } from '../docUtils'

const PROVIDER = 'External AI'

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
      directors: [{
        firstName: '',
        lastName: '',
        jobTitle: []  
      }],
      shareHolders: [{
        firstName: '',
        lastName: '',
        numberOfShares: '',
        // purchasePrice: '',      
      }],
      // totalShares: '',
      // percentageOfShares: ''
    },
    // additionalPrompt: '# Convert numberOfShares to numbers.',
    // additionalPrompt: "# To calculate percentage of shares for each shareholder wait till all of the document is read, first calculate the total number of shares by adding up the number of shares purchased by all shareholders, \nand then calculate the percentage of shares purchased by each shareholder \nbased on the total number of shares.",
    // enumProperties: {
    //   jobTitle: 'tradle.SeniorManagerPosition'
    // },
    moneyProperties: {
      purchasePrice: ""
    }
  },
  companyFormationDocument: {
    additionalPrompt: 'You must include country and registration number in response!'
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
  public async exec({payload, prop, req}) {
    // Form now only 1 doc will be processed
    let base64
    if (Array.isArray(payload[prop])) base64 = payload[prop][0].url
    else base64 = payload[prop].url
   
    let ret = await getPDFContent(base64, this.logger)
    let params:any = {
      req, 
      bot: this.bot, 
      conf: this.botConf.bot, 
    }
    let chunks = []
    if (!ret) {
      this.logger.debug(`aiCorporateData: Conversion to image for property: ${prop} failed`)  
      return
    }
    if (typeof ret[0] === 'string') 
      chunks = ret
    else {
      this.logger.debug(`aiCorporateData: Textract document for property: ${prop}`)
      let result = await Promise.all(ret.map(r =>  doTextract(r, this.logger)))
      result.forEach((r:any) => chunks.push(r.message.slice(1, r.message.length - 1)))      
    }
    let pages = combinePages(chunks)
    params.message = pages
    const {models} = this.bot
    let model = models[payload[ TYPE]]

    let otherProperties = MAPS[prop]
    if (otherProperties)
      params.otherProperties = otherProperties
    params.model = model
    params.logger = this.logger
    try {          
      this.logger.debug(`aiCorporateData: ChatGPT document for property: ${prop}`)

      let response = await getChatGPTMessage(params)
      if (!response) {
        this.logger.debug(`aiCorporateData: no response from ChatGPT for ${prop}; number of pages: ${pages.length}`)
        return
      }
      return otherProperties && otherProperties.properties 
            ? mapToCpProperties(response, prop, models, this.logger) 
            : normalizeResponse({response, model, models})
    } catch (err) {
      debugger
      this.logger.error('aiCorporateData: ChatGPT failed', err)
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
      if (botConf.bot['dontUseExternalAI']) return
      const { user, application, payload } = req
      // debugger
      if (!application) return
      if (payload[TYPE] !== LEGAL_ENTITY) return
      
      // if (payload.registrationNumber) return

      let {companyFormationDocument, articlesOfAssociationDocument, registrationNumber} = payload
      if (!companyFormationDocument) return
      if (registrationNumber && !articlesOfAssociationDocument) return
      let changed = [] //'articlesOfAssociationDocument', 'companyFormationDocument']
      const { models } = bot
      let dbRes
      if (payload._prevlink) {  //  payload.registrationNumber) {
        dbRes = await bot.objects.get(payload._prevlink) 
        if (checkIfDocumentChanged({dbRes, payload, property: 'companyFormationDocument', models}))
          changed.push('companyFormationDocument')
        else
          logger.debug(`aiCorporateData: Document for "companyFormationDocument" didn't change`)  
        if (articlesOfAssociationDocument && checkIfDocumentChanged({dbRes, payload, property: 'articlesOfAssociationDocument', models}))
          changed.push('articlesOfAssociationDocument')
          else
          logger.debug(`aiCorporateData: Document for "articlesOfAssociationDocument" didn't change`)  
      }
      else {
        changed.push('companyFormationDocument')
        // changed.push('articlesOfAssociationDocument')
      }
      if (!changed.length) return
      await bot.resolveEmbeds(payload)

      for (let i=0; i<changed.length; i++) {
        let prop = changed[i]
        let check
        try {
          logger.debug(`aiCorporateData: reading document for property: ${prop}`)
          let response = await prefillWithChatGPT.exec({payload, prop, req})
          if (!response) {
            logger.debug(`aiCorporateData: no response for document set in property: ${prop}`)
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
  if (dbRes && dbRes[property])
    return dbRes[property].url !== payload[property].url 
  else
    return true

  // let pType = models[payload[TYPE]].properties[property].type
  // let isArray = pType === 'array'
  // let maybeNotChanged
  // if (dbRes  &&  dbRes[property]) {
    // if (isArray)
    //   maybeNotChanged = dbRes[property].length === payload[property].length
    // else  
      // maybeNotChanged = dbRes[property].url === payload[property].url 
  // }
  // if (maybeNotChanged) {
  //   let dbPhotos = dbRes[property]
  //   let payloadPhotos = payload[property]
  //   let same = true
  //   for (let i = 0; i < dbPhotos.length && same; i++) {
  //     let url = dbPhotos[i].url
  //     let idx = payloadPhotos.findIndex(r => r.url === url)
  //     same = idx !== -1
  //   }
  //   if (same) return false
  // }
  // return true
}

function mapToCpProperties(response, property, models, logger) {
  // let { properties } = models[LEGAL_ENTITY_CP]
  let { shareHolders, directors } = response
  if (!shareHolders.length  &&  !directors.length) return
  let people = []
  let totalShares = shareHolders.reduce((a, b) => {
    return a + b.numberOfShares
  }, 0)  
  let smEnum = models[SENIOR_MANAGER_POSITION].enum
  if (JSON.stringify(directors) !== JSON.stringify(MAPS[property].properties.directors) ||
      JSON.stringify(shareHolders) !== JSON.stringify(MAPS[property].properties.shares)) {
    directors.forEach(p => {
      let { firstName, lastName, jobTitle, companyName } = p
      let obj
      let typeOfControllingEntity
      if (firstName && lastName) {
        obj = {
          firstName,
          lastName     
        }
        typeOfControllingEntity = models[TYPE_OF_CP].enum.find(e => e.id === 'person')
      }
      else if (companyName) {
        obj = {
          companyName
        }
        typeOfControllingEntity = models[TYPE_OF_CP].enum.find(e => e.id === 'legalEntity')
      }
      else return

      obj.typeOfControllingEntity = {
        id: `${TYPE_OF_CP}_${typeOfControllingEntity.id}`,
        title: typeOfControllingEntity.title
      }
      if (!jobTitle) {
        jobTitle = []
      }
      else if (!Array.isArray(jobTitle)) {
        jobTitle = [jobTitle]
logger.debug(`aiCorporateData: ChatGPT response for 'articlesOfAssociation': ${jobTitle} is not an array`)        
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

      let sh = shareHolders.find(sh => sh.firstName.toLowerCase() === p.firstName.toLowerCase() && sh.lastName.toLowerCase() === p.lastName.toLowerCase())
      if (sh) 
        obj.percentageOfOwnership = Math.round(sh.numberOfShares/totalShares * 100 * 100)/100
      people.push(obj)
    })
    shareHolders.forEach(sh => {
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
