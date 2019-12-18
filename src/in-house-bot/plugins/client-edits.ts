import _ from 'lodash'
import levenshtein from 'fast-levenshtein'

import constants from '@tradle/constants'
import { Bot, Logger, IPBApp, IPBReq, ITradleObject, CreatePlugin, Applications } from '../types'

import {
  getStatusMessageForCheck,
  toISODateString,
  doesCheckNeedToBeCreated
  // hasPropertiesChanged
} from '../utils'

const { TYPE } = constants
const { VERIFICATION } = constants.TYPES
const PROVIDER = 'Tradle'

const CLIENT_EDITS_CHECK = 'tradle.ClientEditsCheck'
const ASPECTS = 'distance between scanned/prefilled and entered data'

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
    for (let p in rawData) {
      if (rawData[p].distance > distance) {
        status = 'fail'
      }
    }
    if (!status) status = 'pass'
    let pchecks = []
    pchecks.push(this.createCheck({ req, rawData, status }))
    if (rawData.Status === 'pass') pchecks.push(this.createVerification({ rawData, req }))
    let checksAndVerifications = await Promise.all(pchecks)
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
    if (hasChanges) rawData['Differences With Prefilled Form'] = changes
  }

  public createCheck = async ({ rawData, status, req }: IValidityCheck) => {
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
    this.logger.debug(`DocumentValidity status message: ${resource.message}`)
    if (status.message) resource.resultDetails = status.message
    if (rawData) resource.rawData = rawData

    this.logger.debug(`Creating DocumentValidity Check for: ${form.firstName} ${form.lastName}`)
    const check = await this.applications.createCheck(resource, req)
    this.logger.debug(`Created DocumentValidity Check for: ${form.firstName} ${form.lastName}`)
  }

  public createVerification = async ({ rawData, req }) => {
    let { user, application, payload } = req
    const method: any = {
      [TYPE]: 'tradle.APIBasedVerificationMethod',
      api: {
        [TYPE]: 'tradle.API',
        name: 'Document Validator'
      },
      aspect: ASPECTS,
      rawData,
      reference: [
        {
          queryId: `report: DV-${Math.random()
            .toString()
            .substring(2)}`
        }
      ]
    }

    const verification = this.bot
      .draft({ type: VERIFICATION })
      .set({
        document: payload,
        method
      })
      .toJSON()
    // debugger

    await this.applications.createVerification({ application, verification })
    this.logger.debug('Created DocumentValidity Verification')
    if (application.checks)
      await this.applications.deactivateChecks({
        application,
        type: CLIENT_EDITS_CHECK,
        form: payload,
        req
      })
  }
}
export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { logger, conf }) => {
  const clientEdits = new ClientEditsAPI({ bot, applications, logger })
  const plugin = {
    async onmessage(req: IPBReq) {
      if (req.skipChecks) return
      let { distance } = conf
      if (!distance) return
      const { payload } = req

      let sourceOfData = payload._sourceOfData
      if (!sourceOfData) return
      await clientEdits.checkEdits({ req, sourceOfData, distance })
    }
  }

  return {
    plugin
  }
}
