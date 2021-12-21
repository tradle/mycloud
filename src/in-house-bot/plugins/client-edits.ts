import levenshtein from 'fast-levenshtein'

import constants from '@tradle/constants'
import validateResource from '@tradle/validate-resource'
import { enumValue } from '@tradle/build-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

import { Bot, Logger, IPBReq, CreatePlugin, Applications } from '../types'

import { doesCheckNeedToBeCreated, isSubClassOf } from '../utils'
import cloneDeep from 'lodash/cloneDeep'
import extend from 'lodash/extend'
import size from 'lodash/size'
import isEqual from 'lodash/isEqual'

const { TYPE } = constants
const { FORM, VERIFICATION } = constants.TYPES
const PROVIDER = 'Tradle'

const CLIENT_EDITS_CHECK = 'tradle.ClientEditsCheck'
const MODIFICATION = 'tradle.Modification'
const ASPECTS = 'Fuzzy match'
const DIFFERENCE_WITH_PREFILL = 'Differences With Prefilled Form'
const PHOTO_ID = 'tradle.PhotoID'
const DATA_SOURCE_REFRESH = 'tradle.DataSourceRefresh'
const REFERENCE_DATA_SOURCES = 'tradle.ReferenceDataSources'
const SHARE_REQUEST = 'tradle.ShareRequest'
const SHARE_REQUEST_SUBMITTED = 'tradle.ShareRequestSubmitted'

interface IValidityCheck {
  rawData: any
  status: any
  req: IPBReq
}

class ClientEditsAPI {
  private bot: Bot
  private logger: Logger
  private applications: Applications
  constructor({ bot, applications, logger }) {
    this.bot = bot
    this.applications = applications
    this.logger = logger
  }

  public async checkEdits({ req, sourceOfData, distance }) {
    let { payload, application } = req
    let prefill
    try {
      let formRequest = await this.bot.getResource(sourceOfData)
      prefill = formRequest.prefill
    } catch (err) {
      this.logger.debug(`Source of data is probably from a different provider`)
      return
    }
    if (!prefill || !size(prefill)) return
    let createCheck = await doesCheckNeedToBeCreated({
      bot: this.bot,
      type: CLIENT_EDITS_CHECK,
      application,
      provider: PROVIDER,
      form: payload,
      propertiesToCheck: Object.keys(prefill),
      prop: 'form',
      req
    })

    // debugger
    if (!createCheck && !prefill) {
      this.logger.debug(
        `CheckEdits: check already exists for ${payload.firstName} ${payload.lastName} ${payload.documentType.title}`
      )
      return
    }
    let rawData: any = {}

    if (prefill) this.checkTheDifferencesWithPrefill(payload, rawData, prefill)
    if (!size(rawData)) return
    let status
    let diff = rawData[DIFFERENCE_WITH_PREFILL]
    for (let p in diff) {
      if (diff[p].distance > distance) {
        status = 'fail'
      }
    }
    if (!status) status = 'pass'
    return await this.createCheck({ req, rawData, status })
  }
  public async handleShareRequest({resource, shareFrom}:{resource:any, shareFrom?:boolean}) {
    debugger
    let propName, author
    if (shareFrom) {
      propName = 'from'
      author = resource._org
      // author = await this.bot.identities.byPermalink(resource._org)
      // if (!author) {
      //   debugger
      //   this.logger.debug(`No identity found for ${resource._org}`)
      // }
      // author = author._link
    }
    else {
      propName = 'with'
      author = resource._author
    }
    let resources = await this.getSharedResources(resource, author)
    let sharedId = shareFrom ? author : resource.with[0]._permalink
    let modifications = []
    for (let i=0; i<resources.length; i++) {
      let isVerification = resources[i][TYPE] === VERIFICATION
      modifications.push(this.bot
        .draft({ type: MODIFICATION })
        .set({
            dateModified: Date.now(), //rawData.updated_at ? new Date(rawData.updated_at).getTime() : new Date().getTime(),
            form: isVerification ? resources[i].document : resources[i],
            modifications: {
              shared: {
                [propName]: sharedId,
                isVerification
              }
            }
        })
        .signAndSave()
      )
    }
    try {
      await Promise.all(modifications)
    } catch (err) {
      debugger
      this.logger.debug(`Error sharing resources ${propName} ${sharedId}`)
    }
  }

  private async getSharedResources(resource, author) {
    debugger
    let { formStubs, verificationStubs} = resource
    if (formStubs) return formStubs

    if (resource.verificationStubs) {
      let verifications = await Promise.all(verificationStubs.map(v => this.bot.getResource(v)))
      return verifications
    }

    let msgs
    try {
      msgs = await Promise.all(resource.links.map(link => this.bot.getMessageWithPayload({
        select: ['object'],
        link,
        author,
        inbound: true
      })))
    } catch (err) {
      debugger
      this.logger.debug(`Message was not found for one of the links ${resource.links}`)
      // return
    }
    if (!msgs || !msgs.length) return
    try {
      return await Promise.all(msgs.map((msg:any) => this.bot.db.findOne({
        filter: {
          EQ: {
            [TYPE]: msg.object[TYPE],
            _link: msg.object._link
          }
        }
      })))
    } catch (err) {
      debugger
    }
  }
  private checkTheDifferencesWithPrefill(payload, rawData, prefill) {
    let props = this.bot.models[payload[TYPE]].properties
    let hasChanges
    let changes = {}
    for (let p in payload) {
      let prop = props[p]
      if (!prop || prop.displayAs) continue
      let val = prefill[p]
      if (!val) continue
      let isClientUse = prop.clientUse
      let entered = isClientUse && 'entered ***' || payload[p]
      let prefilled = isClientUse && 'prefilled: ***' || val
      if (!payload[p]) {
        hasChanges = true
        changes[prop.title] = {
          prefilled,
          entered,
          message: `No value entered for ${prop.title}`
        }
        continue
      }

      if (prop.type === 'string') {
        let distance = levenshtein.get(val, payload[p], {
          useCollator: true
        })
        if (distance) {
          hasChanges = true
          changes[prop.title || p] = {
            prefilled,
            entered,
            distance
          }
        }
      }
    }
    if (hasChanges) rawData[DIFFERENCE_WITH_PREFILL] = changes
  }

  public async createCheck({ rawData, status, req }: IValidityCheck) {
    let dateStr = rawData.updated_at
    let date
    if (dateStr) date = Date.parse(dateStr) - new Date().getTimezoneOffset() * 60 * 1000
    else date = new Date().getTime()
    let { application, payload } = req
    let form = payload
    let resource: any = {
      [TYPE]: CLIENT_EDITS_CHECK,
      status,
      provider: PROVIDER,
      application,
      dateChecked: date, //rawData.updated_at ? new Date(rawData.updated_at).getTime() : new Date().getTime(),
      aspects: ASPECTS,
      form
    }
    // debugger
    if (rawData && status !== 'pass') {
      let props = this.bot.models[form[TYPE]].properties
      for (let p in rawData) {
        if (!props[p]) continue
        if (!resource.message) resource.message += '; '
        resource.message = rawData[p]
      }
    }
    // resource.message = getStatusMessageForCheck({models: this.bot.models, check: resource})
    this.logger.debug(`ClientEdits status message: ${resource.message}`)
    if (status.message) resource.resultDetails = status.message
    if (rawData) resource.rawData = rawData

    this.logger.debug(`Creating ClientEdits Check for: ${form.firstName} ${form.lastName}`)
    let check = await this.applications.createCheck(resource, req)
    return check.toJSON({ virtual: true })
  }

  public createModification = async ({
    req,
    check,
    checks
  }: {
    req: IPBReq
    check: any
    checks?: any
  }) => {
    const { payload } = req

    let prevResource
    if (payload._p) {
      try {
        prevResource = (await this.bot.objects.get(payload._p))
      } catch (err) {
        debugger
      }
    }

    let isInitialSubmission, prefill
    if (payload._sourceOfData) {
      if (
        !prevResource ||
        !prevResource._sourceOfData ||
        prevResource._sourceOfData._permalink !== payload._sourceOfData._permalink
      ) {
        ;({ prefill } = await this.createDataLineageModification({ req }))
        if (prefill) {
          isInitialSubmission = !prevResource // true
          if (!isInitialSubmission) {
            prevResource = cloneDeep(prevResource)
            extend(prevResource, prefill)
          }
        }
      }
    } else if (payload[TYPE] === PHOTO_ID && payload.scanJson)
      ({ prefill } = await this.createDataLineageModification({ req }))
    else {
      let props = this.bot.models[payload[TYPE]].properties
      let hasScanner
      for (let p in props) {
        if (props[p].scanner) {
          hasScanner = true
          break
        }
      }
      isInitialSubmission = !hasScanner
      prefill = {}
    }
    if (isInitialSubmission) prevResource = prefill
    let props = this.bot.models[payload[TYPE]].properties
    let modifications: any = {}
    if (prevResource) {
      let added: any = {}
      let changed: any = {}
      let removed: any = {}
      for (let p in props) {
        if (props[p].displayAs || p.charAt(0) === '_') continue
        let isClientUse = props[p].clientUse
        if (payload[p]) {
          if (!prevResource[p]) {
            extend(added, { [p]: isClientUse && 'new: ***' || payload[p] })
            continue
          } else if (!isEqual(payload[p], prevResource[p])) {
            extend(changed, {
              [p]: {
                new: isClientUse && 'new: ***' || payload[p],
                old: isClientUse && 'old: ***' || prevResource[p]
              }
            })
          }
        } else if (prevResource[p]) {
          extend(removed, { [p]: p })
        }
      }
      if (size(added)) extend(modifications, { added })
      if (size(changed)) extend(modifications, { changed })
      if (size(removed)) extend(modifications, { removed })
    }
    if (!size(modifications) && !check && !checks) return

    if (check) {
      extend(modifications, {
        checks: [
          {
            hash: check._permalink,
            type: check[TYPE],
            displayName: check.aspects,
            status: check.status
          }
        ]
      })
    }
    if (checks) {
      if (!modifications.checks) modifications.checks = []
      checks.forEach(check =>
        modifications.checks.push({
          hash: check._permalink,
          type: check[TYPE],
          displayName: check.aspects,
          status: check.status
        })
      )
    }
    if (isInitialSubmission) {
      modifications = {
        initialSubmission: modifications
      }
    }

    let resource: any = {
      [TYPE]: MODIFICATION,
      dateModified: Date.now(), //rawData.updated_at ? new Date(rawData.updated_at).getTime() : new Date().getTime(),
      form: payload,
      modifications
    }

    return await this.bot
      .draft({ type: MODIFICATION })
      .set(resource)
      .signAndSave()
  }
  public createDataLineageModification = async ({ req, checks }: { req: IPBReq; checks?: any }) => {
    const { payload } = req
    const sourceOfData = payload._sourceOfData
    let dataLineage, prefill
    if (sourceOfData) {
      try {
        ({ dataLineage, prefill } = await this.bot.getResource(sourceOfData))
      } catch (err) {
        debugger
      }
    }
    else if (payload[TYPE] !== PHOTO_ID || !payload.scanJson) return
    else {
      let { address, personal, document } = payload.scanJson
      prefill = { ...personal, ...document, ...address }
      let provider = enumValue({
        model: this.bot.models[REFERENCE_DATA_SOURCES],
        value: 'regula'
      })
      dataLineage = {
        [provider.id]: {
          properties: Object.keys(prefill)
        }
      }
    }

    if (!dataLineage) return {}

    for (let p in dataLineage) {
      let props = dataLineage[p].properties
      try {
        let dataSource = await this.bot.db.findOne({
          filter: {
            EQ: {
              [TYPE]: DATA_SOURCE_REFRESH,
              'name.id': p
            }
          }
        })
      } catch (err) {
        // debugger
      }
      let properties = {}
      if (props) {
        props.forEach(p => {
          properties[p] = prefill[p]
        })
        dataLineage[p] = properties
      } else debugger
    }
    dataLineage = sanitize(dataLineage).sanitized
    let modifications: any = { dataLineage }

    if (checks) {
      if (!modifications.checks) modifications.checks = []
      checks.forEach(check =>
        modifications.checks.push({
          hash: check._permalink,
          type: check[TYPE],
          displayName: check.aspects,
          status: check.status
        })
      )
    }

    let resource: any = {
      [TYPE]: MODIFICATION,
      dateModified: Date.now(), //rawData.updated_at ? new Date(rawData.updated_at).getTime() : new Date().getTime(),
      form: payload,
      modifications
    }

    return {
      modification: await this.bot
        .draft({ type: MODIFICATION })
        .set(resource)
        .signAndSave(),
      prefill
    }
  }
}
export const createPlugin: CreatePlugin<void> = (components, { logger, conf }) => {
  const { bot, productsAPI, employeeManager, applications } = components
  const clientEdits = new ClientEditsAPI({ bot, applications, logger })
  const plugin = {
    async onmessage(req: IPBReq) {
      // if (req.skipChecks) return
      const { payload, application } = req
      if (!payload._link) return
      if (payload[TYPE] === SHARE_REQUEST_SUBMITTED) {
        debugger
        return
      }  

      if (payload[TYPE] === SHARE_REQUEST) {
        let { formStubs, verificationStubs} = payload
        if (!formStubs && !verificationStubs)
          return
        let myIdentity = await bot.getMyIdentity()
        let { with:sharedWith } = payload
        if (sharedWith.find(w => w._link === myIdentity._link))
          await clientEdits.handleShareRequest({resource: payload, shareFrom: true})
        else
          await clientEdits.handleShareRequest({resource: payload})
      }
      if (!application)
        return
      const { models } = bot
      if (!isSubClassOf(FORM, models[payload[TYPE]], models)) return
      const sourceOfData = payload._sourceOfData

      let { distance } = conf

      let checks =
        req.latestChecks && req.latestChecks.filter(check => check.form._link === payload._link)

      // debugger
      let check
      if (distance && sourceOfData)
        check = await clientEdits.checkEdits({ req, sourceOfData, distance })

      await clientEdits.createModification({ req, check, checks })
    }
  }

  return {
    plugin
  }
}
