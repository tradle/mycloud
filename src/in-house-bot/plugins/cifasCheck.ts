import https from 'https'
import HttpsProxyAgent from 'https-proxy-agent'
import fs from 'fs'
import path from 'path'
import nunjucks from 'nunjucks'
import xml2js from 'xml2js-parser'
import dateformat from 'dateformat'

import { TYPE } from '@tradle/constants'

// @ts-ignore
import {
  getStatusMessageForCheck,
  doesCheckNeedToBeCreated
} from '../utils'

import {
  Bot,
  CreatePlugin,
  Applications,
  IPluginLifecycleMethods,
  ValidatePluginConf,
  IConfComponents,
  ITradleObject,
  IPBApp,
  IPBReq,
  Logger
} from '../types'
import Errors from '../../errors'

import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

const ON_TYPE = 'tradle.PhotoID'

const FRAUD_PREVENTION_CHECK = 'tradle.FraudPreventionCheck'
const PROVIDER = 'Cifas.org'
const ASPECTS = 'Fraud prevention'
const COMMERCIAL = 'commercial'

const CIFAS_HOST = 'training-services.find-cifas.org.uk'

const BASIC_SEARCH_REQUEST_TEMPLATE = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:fh="http://header.find-cifas.org.uk"
               xmlns:doc="http://objects.find-cifas.org.uk/Direct">
  <soap:Header>
    <fh:StandardHeader>
      <fh:RequestingInstitution>{{config.requestingInstitution}}</fh:RequestingInstitution>
      <fh:OwningMemberNumber>{{config.owningMemberNumber}}</fh:OwningMemberNumber>
      <fh:ManagingMemberNumber>{{config.managingMemberNumber}}</fh:ManagingMemberNumber>
      <fh:CurrentUser>{{config.currentUser}}</fh:CurrentUser>
      <fh:SchemaVersion>3-00</fh:SchemaVersion>
    </fh:StandardHeader>
  </soap:Header>
  <soap:Body>
    <doc:BasicSearchRequest>
      <doc:Search>
        <doc:Product>{{search.product}}</doc:Product>
        <doc:SearchType>{{search.searchType}}</doc:SearchType>
        <doc:MemberSearchReference>{{search.memberSearchReference}}</doc:MemberSearchReference>
        <doc:Party>
          <doc:PartySequence>{{search.partySequence}}</doc:PartySequence>
          <doc:Relevance>{{search.relevance}}</doc:Relevance>
          <doc:Surname>{{params.lastName}}</doc:Surname>
          <doc:FirstName>{{params.firstName}}</doc:FirstName>
          <doc:BirthDate>{{params.dateOfBirth}}</doc:BirthDate>
          <!--doc:EmailAddress>borysdudek@dayrep.com</doc:EmailAddress-->
        </doc:Party>
      </doc:Search>
    </doc:BasicSearchRequest>
  </soap:Body>
</soap:Envelope>`

interface ICifasCheck {
  application: IPBApp
  status: any
  form: ITradleObject
  rawData?: any
  req: IPBReq
}

interface ICifasConf {
  cifasHost: string,
  requestingInstitution: string,
  owningMemberNumber: string,
  managingMemberNumber: string,
  currentUser: string,
  passphrase: string,
  proxy?: string
}

interface BasicSearchQuery {
  firstName: string,
  lastName: string,
  dateOfBirth: string
}

const search = {
  product: 'PXXX',
  searchType: 'XX',
  memberSearchReference: 'tradlecustomerref',
  partySequence: 1,
  relevance: 'APP'
}

export class CifasCheckAPI {
  private bot: Bot
  private conf: any
  private applications: Applications
  private logger: Logger

  constructor({ bot, conf, applications, logger }) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
    this.logger = logger
  }

  httpRequest = (params: any, postData: string) => {
    return new Promise<string>(function (resolve, reject) {
      let req = https.request(params, function (res) {
        // reject on bad status
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error('statusCode=' + res.statusCode));
        }
        // cumulate data
        let body = []
        res.on('data', function (chunk) {
          body.push(chunk);
        })
        // resolve on end
        res.on('end', function () {
          try {
            let xml = Buffer.concat(body).toString('utf-8');
            resolve(xml);
          } catch (e) {
            reject(e);
          }
        })
      })
      // reject on request error
      req.on('error', function (err) {
        // This is not a "Second reject", just a different sort of failure
        reject(err);
      })
      if (postData) {
        req.write(postData);
      }
      // IMPORTANT
      req.end();
    })
  }

  queryCifra = async (query: BasicSearchQuery) => {
    let input = { config: this.conf, search, params: query }

    const data = nunjucks.renderString(BASIC_SEARCH_REQUEST_TEMPLATE, input)

    let options: any = {
      hostname: this.conf.cifasHost,
      port: 443,
      path: '/Direct/Cifas/Request.asmx',
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=UTF-8',
        'Content-Length': data.length
      },

      pfx: fs.readFileSync(path.resolve(__dirname, '../../../data/cifas-training.pfx')),
      passphrase: this.conf.passphrase
    }

    if (this.conf.proxy)
      options.agent = new HttpsProxyAgent(this.conf.proxy)

    try {
      let xml: string = await this.httpRequest(options, data)
      return { xml, error: null }
    } catch (err) {
      return { xml: undefined, error: err.message }
    }
  }

  searchCifas = async (payload: any, application: IPBApp, req: IPBReq) => {
    let q: BasicSearchQuery = {
      firstName: payload.firstName,
      lastName: payload.lastName,
      dateOfBirth: dateformat(new Date(payload.dateOfBirth), 'yyyy-mm-dd')
    }

    let status: any
    let rawData: any
    let res = await this.queryCifra(q)
    if (res.error) {
      status = {
        status: 'error',
        message: res.error
      }
    }
    else {
      let parser = new xml2js.Parser({ explicitArray: false, trim: true });
      let jsonObj = parser.parseStringSync(res.xml)
      this.logger.debug(JSON.stringify(jsonObj, null, 2))
      rawData = jsonObj

      if (jsonObj["soap:Envelope"]["soap:Body"].BasicSearchResponse.BasicSearchResult) {
        // fraud suspect
        status = {
          status: 'fail',
          message: `Fraud suspect`
        }
      }
      else {
        // all is well
        status = { status: 'pass' }
      }
    }

    await this.createCheck({ application, status, form: payload, rawData, req })
  }

  public createCheck = async ({ application, status, form, rawData, req }: ICifasCheck) => {
    let model = this.bot.models[FRAUD_PREVENTION_CHECK]
    // debugger
    let resource: any = {
      [TYPE]: FRAUD_PREVENTION_CHECK,
      status: status.status,
      sourceType: COMMERCIAL,
      provider: PROVIDER,
      application,
      dateChecked: new Date().getTime(),
      aspects: ASPECTS,
      form
    }

    resource.message = getStatusMessageForCheck({ models: this.bot.models, check: resource })
    if (status.message) resource.resultDetails = status.message
    if (rawData)
      resource.rawData = sanitize(rawData).sanitized

    this.logger.debug(`${PROVIDER} Creating cifasCheck`)
    await this.applications.createCheck(resource, req)
    this.logger.debug(`${PROVIDER} Created cifasCheck`)
  }

}


export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const cifasCheckAPI = new CifasCheckAPI({ bot, conf, applications, logger })
  // debugger
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req: IPBReq) {
      logger.debug('cifasCheck called onmessage')
      if (req.skipChecks) return
      const { application, payload } = req
      if (!application) return
      if (ON_TYPE != payload[TYPE]) return

      if (!payload.firstName || !payload.lastName || !payload.dateOfBirth) return
      logger.debug(`cifasCheck called for type ${payload[TYPE]}`)

      logger.debug('cifasCheck before doesCheckNeedToBeCreated')
      let createCheck = await doesCheckNeedToBeCreated({
        bot,
        type: FRAUD_PREVENTION_CHECK,
        application,
        provider: PROVIDER,
        form: payload,
        propertiesToCheck: ['firstName', 'lastName', 'dateOfBirth'],
        prop: 'form',
        req
      })
      logger.debug(`cifasCheck after doesCheckNeedToBeCreated with createCheck=${createCheck}`)

      if (!createCheck) return
      let r = await cifasCheckAPI.searchCifas(payload, application, req)
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
  pluginConf: ICifasConf
}) => {
  if (!pluginConf.cifasHost || typeof pluginConf.cifasHost != 'string') {
    throw new Errors.InvalidInput(`property 'cifasHost' is not set`)
  }
  if (!pluginConf.requestingInstitution || typeof pluginConf.requestingInstitution != 'string') {
    throw new Errors.InvalidInput(`property 'requestingInstitution' is not set`)
  }
  if (!pluginConf.currentUser || typeof pluginConf.currentUser != 'string') {
    throw new Errors.InvalidInput(`property 'currentUser' is not set`)
  }
  if (!pluginConf.managingMemberNumber || typeof pluginConf.managingMemberNumber != 'string') {
    throw new Errors.InvalidInput(`property 'managingMemberNumber' is not set`)
  }
  if (!pluginConf.owningMemberNumber || typeof pluginConf.owningMemberNumber != 'string') {
    throw new Errors.InvalidInput(`property 'owningMemberNumber' is not set`)
  }
  if (!pluginConf.passphrase || typeof pluginConf.passphrase != 'string') {
    throw new Errors.InvalidInput(`property 'passphrase' is not set`)
  }
}

