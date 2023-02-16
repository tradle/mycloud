// renamed from leasingSignoff
import extend from 'lodash/extend'
import {
  CreatePlugin,
  Bot,
  Logger,
  Applications,
  IPluginLifecycleMethods,
  ValidatePluginConf,
  IWillJudgeAppArg,
  IPBApp,
  ITradleCheck,
  ValidatePluginConfOpts
} from '../types'
import { TYPE } from '@tradle/constants'
import validateModels from '@tradle/validate-model'

const { isEnumProperty } = validateModels.utils

import { getEnumValueId } from '../../utils'
import { getLatestChecks, isSubClassOf } from '../utils'
import { Errors } from '../..'
import { appLinks } from '../../app-links'

import { type } from 'os'
const STATUS = 'tradle.Status'
const OVERRIDE_STATUS = 'tradle.OverrideStatus'
const CHECK_OVERRIDE = 'tradle.CheckOverride'
const EXCLUDE_CHECKS = ['tradle.ClientEditsCheck']
const PROVIDER = 'Tradle'

class WorkflowSignoffAPI {
  private bot: Bot
  private logger: Logger
  private applications: Applications
  private conf: any
  constructor({ bot, conf, applications, logger }) {
    this.bot = bot
    this.applications = applications
    this.logger = logger
    this.conf = conf
  }
  public async checkAndCreate({application, templates, checkOverride}:{
    application: any,
    templates: any,
    checkOverride?:any
  }) {
    const { bot, conf, logger } = this
    let { checks, checksOverride, requestFor } = application
    const productConf = conf.products[requestFor]
    if (!productConf) return

    let { signoffChecks } = productConf
    if (!signoffChecks) return
    const { models } = this.bot

    if (!checks) {
      return await this.createSignoffChecks({application, signoffChecks, templates})
    }
    // Checks were created already
    let signOffChecksCount = 0
    if (signoffChecks.components) {
      let { checkId } = signoffChecks.components
      checks.forEach(chk => chk[TYPE] === checkId && signOffChecksCount++)
    }
    else
      checks.forEach(check => signoffChecks[check[TYPE]] && signOffChecksCount++)
    if (signOffChecksCount) return
    if (!checksOverride) {
      if (checkOverride)
        checksOverride = [checkOverride]
    }
    else if (checksOverride.length === 1  && checkOverride && checksOverride[0]._permalink === checksOverride._permalink)
      checksOverride = [checkOverride]
    else {
      if (checkOverride) {
        let idx = checksOverride.findIndex(co => co._permalink === checkOverride._permalink)
        if (idx === -1)
          logger.debug(`CheckOverride is not yet in DB`)
        else
          checksOverride.splice(idx, 1)
      }
      if (checksOverride.length)
        checksOverride = await Promise.all(checksOverride.map(o => bot.getResource(o)))
      if (checkOverride)
        checksOverride.push(checkOverride)
    }
    let { latestChecks } = checks &&  await getLatestChecks({ application, bot })

    for (let j=0; j<latestChecks.length; j++) {
      let check = latestChecks[j]
      let checkType = check[TYPE]
      if (EXCLUDE_CHECKS.indexOf(checkType) !== -1)
        continue
      let status = getEnumValueId({model: models[STATUS], value: check.status})
      if (status === 'pass') continue

      let override = checksOverride && checksOverride.find(co => co[TYPE] === `${checkType}Override`)
      if (!override) {
        logger.debug(`No check override for failed ${models[checkType].title}`)
        return
      }
      if (getEnumValueId({model: models[OVERRIDE_STATUS], value: override.status}) !== 'pass') return
    }
    return await this.createSignoffChecks({application, signoffChecks, checks, latestChecks, templates})
  }
  async createConditionalChecks({signoffChecks, templates, checks, latestChecks, application}) {
    const { components, conditions } = signoffChecks
    const { form, property, checkId } = components

    let sub = application.submissions.find(sub => sub.submission[TYPE] === form)
    if (!sub) return
    const { models } = this.bot
    let model = models[sub.submission[TYPE]]
    let f = await this.bot.getResource(sub.submission)
    let p = f[property]
    let condition = isEnumProperty({models, property: model.properties[property]})
                  ? p.title
                  : p
    let soChecks = []
    for (let i=0; i<conditions.length; i++) {
      let cond = conditions[i]
      const { aspects } = cond

      let link = this.createTemplateLink({templates, application, templateTitle: aspects, isEmployee: true})
      if (!link) continue
      if (cond[property].indexOf(condition) === -1) continue

      let propsToSet = Object.keys(cond).filter(c => c !== property)

      let resource: any = {
        [TYPE]: checkId,
        status: 'warning',
        provider: PROVIDER,
        application,
        dateChecked: new Date().getTime(),
      }
      if (propsToSet)
        propsToSet.forEach(p => resource[p] = cond[p])
      resource.documentToBeNotarised = link
      this.logger.debug(`creating ${checkId}`)
      soChecks.push(this.applications.createCheck(resource, {application, checks, latestChecks}))
    }
    return await Promise.all(soChecks)
  }
  async createSignoffChecks({application, signoffChecks, checks, latestChecks, templates}:{
    application: IPBApp,
    signoffChecks:any,
    checks?:ITradleCheck[],
    latestChecks?:ITradleCheck[]
    templates?: any[]}
    ) {
    if (signoffChecks.components)
      return await this.createConditionalChecks({application, signoffChecks, checks, latestChecks, templates})

    let soChecks = []
    for (let checkId in signoffChecks) {
      let resource: any = {
        [TYPE]: checkId,
        status: 'warning',
        provider: PROVIDER,
        application,
        dateChecked: new Date().getTime(),
        aspects: signoffChecks[checkId],
      }
      let link = this.createTemplateLink({templates, application, templateTitle: resource.name, isEmployee: true})
      if (link)
        resource.documentToBeNotarised = link

      this.logger.debug(`creating ${checkId}`)
      soChecks.push(this.applications.createCheck(resource, {application, checks, latestChecks}))
    }
    return await Promise.all(soChecks)
  }
  createTemplateLink({templates, application, templateTitle, isEmployee}:{
    templates: any[],
    application: IPBApp,
    templateTitle: string
    isEmployee: boolean
  }) {
    if (!templates || !templates.length) return
    let template = templates.find(t => t.title === templateTitle)
    if (!template)  return
    
    this.bot.logger.debug(`found template: ${template.title}`)
    let args = {
      type: application[TYPE],
      baseUrl: '',
      platform: 'web',
    }
    if (isEmployee) {
      extend(args, {
        permalink: application._permalink,
        link: application._link,
      })
    }
    else {
      const { request } = application
      extend(args, {
        permalink: request._permalink,
        link: request._link,
      })
    }  
    let link = appLinks.getResourceLink(args)
    return `${link}&-template=${encodeURIComponent(templateTitle)}`
  }  
}
  
export const createPlugin: CreatePlugin<void> = (components, { conf, logger }) => {
  const { bot, applications, conf:botConf, employeeManager } = components
  const WorkflowSignoff = new WorkflowSignoffAPI({ bot, conf, applications, logger })
  const plugin: IPluginLifecycleMethods = {
    async onFormsCollected({ req }) {
      const { application } = req
      if (!application ||  application.status === 'approved') return
      if (application.processingDataBundle) return
      let templates = botConf.bot['templates'] //.filter(t => t.notarizable && t.applicationFor === application.requestFor).map(t => t.title)
      await WorkflowSignoff.checkAndCreate({application, templates})
    },
    async onmessage(req) {
      const { application, payload } = req
      if (!application || application.status !== 'completed') return
      let { requestFor } = application

      const productConf = conf.products && conf.products[requestFor]
      if (!productConf) return

      let { signoffChecks } = productConf
      if (!signoffChecks) return

      const ptype = payload[TYPE]
      const { models } = bot
      if (!isSubClassOf(CHECK_OVERRIDE, models[ptype], models)) return

      let checkId = ptype.slice(0, -8)
      const checkStatus = getEnumValueId({model: models[OVERRIDE_STATUS], value: payload.status})
      if (checkStatus !== 'fail')
        if (signoffChecks[checkId]) return

      if (checkStatus !== 'pass')
        return
      let templates = botConf.bot['templates']
      await WorkflowSignoff.checkAndCreate({application, templates, checkOverride: payload})
    },
    async willApproveApplication (opts: IWillJudgeAppArg) {
      const { application } = opts

      if (application.status === 'approved') return

      let { requestFor } = application

      const productConf = conf.products && conf.products[requestFor]
      if (!productConf) return

      let { signoffChecks } = productConf
      if (!signoffChecks) return
      let message = 'Application should be completed before approval'
      if (application.status === 'started')
        throw new Errors.AbortError(message)
    },
    async willRequestForm({user, formRequest, application}) {
      const {requestFor} = application
      const templates = botConf.bot['templates']
      if (!application || !templates || !conf.products || !conf.products[requestFor] || !conf.products[requestFor].signoffForm) return
      let { form, property, template:templateTitle } = conf.products[requestFor].signoffForm
      const { models } = bot

      if (!form || form !== formRequest.form || !property || !models[form].properties[property] || !templateTitle) return
      let template = templates.find(t => t.title === templateTitle)
      if (!template) return

      if (!formRequest.prefill)
        formRequest.prefill = {[TYPE]: form}

      let link = await WorkflowSignoff.createTemplateLink({templates, application, templateTitle, isEmployee: employeeManager.isEmployee({user})})
      if (link)
        formRequest.prefill[property] = link
    }
  }
  return {
    plugin
  }
}

export const validateConf: ValidatePluginConf = async (opts: ValidatePluginConfOpts) => {
  const { bot, conf, pluginConf } = opts
  const { models } = bot
  const { products } = pluginConf
  if (!products)
    throw new Error('missing "products"')
  for (let p in products) {
    if (!models[p])
      throw new Error(`Not found model: ${p}`)
  }
}