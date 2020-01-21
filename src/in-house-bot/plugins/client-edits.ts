import _ from 'lodash'
import levenshtein from 'fast-levenshtein'

import constants from '@tradle/constants'
import validateResource from '@tradle/validate-resource'
import { enumValue } from '@tradle/build-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

import { Bot, Logger, IPBReq, CreatePlugin, Applications } from '../types'

import { doesCheckNeedToBeCreated, isSubClassOf } from '../utils'

const { TYPE } = constants
const { FORM } = constants.TYPES
const PROVIDER = 'Tradle'

const CLIENT_EDITS_CHECK = 'tradle.ClientEditsCheck'
const MODIFICATION = 'tradle.Modification'
const ASPECTS = 'Fuzzy match'
const DIFFERENCE_WITH_PREFILL = 'Differences With Prefilled Form'
const PHOTO_ID = 'tradle.PhotoID'
const DATA_SOURCE_REFRESH = 'tradle.DataSourceRefresh'
const REFERENCE_DATA_SOURCES = 'tradle.ReferenceDataSources'

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
    let { user, payload, application } = req
    let formRequest = await this.bot.getResource(sourceOfData)

    let prefill = formRequest.prefill
    if (!prefill || !_.size(prefill)) return
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
    if (!_.size(rawData)) return
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

  public checkTheDifferencesWithPrefill(payload, rawData, prefill) {
    let props = this.bot.models[payload[TYPE]].properties
    let hasChanges
    let changes = {}
    for (let p in payload) {
      let prop = props[p]
      if (!prop || prop.displayAs) continue
      let val = prefill[p]
      if (!val) continue
      if (!payload[p]) {
        hasChanges = true
        changes[prop.title] = {
          prefilled: val,
          entered: payload[p],
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
            prefilled: val,
            entered: payload[p],
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

    let prevResource = payload._p && (await this.bot.objects.get(payload._p))

    let isInitialSubmission, prefill
    if (payload._sourceOfData) {
      if (
        !prevResource ||
        !prevResource._sourceOfData ||
        prevResource._sourceOfData._permalink !== payload._sourceOfData._permalink
      ) {
        ;({ prefill } = await this.createDataLineageModification({ req }))
        isInitialSubmission = true
      }
    } else if (payload[TYPE] === PHOTO_ID && payload.scanJson)
      ({ prefill } = await this.createDataLineageModification({ req }))

    if (isInitialSubmission) prevResource = prefill
    let props = this.bot.models[payload[TYPE]].properties
    let modifications: any = {}
    if (prevResource) {
      let added: any = {}
      let changed: any = {}
      let removed: any = {}
      for (let p in props) {
        if (props[p].displayAs) continue
        if (payload[p]) {
          if (!prevResource[p]) {
            _.extend(added, { [p]: payload[p] })
            continue
          } else if (!_.isEqual(payload[p], prevResource[p])) {
            _.extend(changed, {
              [p]: {
                new: payload[p],
                old: prevResource[p]
              }
            })
          }
        } else if (prevResource[p]) {
          _.extend(removed, { [p]: p })
        }
      }
      if (_.size(added)) _.extend(modifications, { added })
      if (_.size(changed)) _.extend(modifications, { changed })
      if (_.size(removed)) _.extend(modifications, { removed })
    }
    if (!_.size(modifications) && !check && !checks) return

    if (check) {
      _.extend(modifications, {
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
    if (sourceOfData) ({ dataLineage, prefill } = await this.bot.getResource(sourceOfData))
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
        debugger
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
export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { logger, conf }) => {
  const clientEdits = new ClientEditsAPI({ bot, applications, logger })
  const plugin = {
    async onmessage(req: IPBReq) {
      // if (req.skipChecks) return
      const { payload, application } = req
      if (!payload._link) return
      if (!application) return
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
