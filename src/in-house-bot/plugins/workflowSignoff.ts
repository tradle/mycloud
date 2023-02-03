// renamed from leasingSignoff
import uniqBy from 'lodash/uniqBy'
import {
  CreatePlugin,
  Bot,
  Logger,
  Applications,
  IPluginLifecycleMethods,
  ValidatePluginConf,
  IWillJudgeAppArg,
  ITradleObject,
  IPBApp,
  ITradleCheck,
  ValidatePluginConfOpts
} from '../types'
import { TYPE } from '@tradle/constants'
import { getEnumValueId } from '../../utils'
import { getLatestChecks, isSubClassOf } from '../utils'
import { Errors } from '../..'
import { appLinks } from '../../app-links'
const STATUS = 'tradle.Status'
const OVERRIDE_STATUS = 'tradle.OverrideStatus'
const CHECK_OVERRIDE = 'tradle.CheckOverride'
const EXCLUDE_CHECKS = ['tradle.ClientEditsCheck']

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
  public async checkAndCreate({application, templates}) {
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
    checks.forEach(check => signoffChecks[check[TYPE]] && signOffChecksCount++)
    if (signOffChecksCount) return
    if (checksOverride)
      checksOverride = await Promise.all(checksOverride.map(o => bot.getResource(o)))
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
  async createSignoffChecks({application, signoffChecks, checks, latestChecks, templates}:{
    application: IPBApp,
    signoffChecks:any,
    checks?:ITradleCheck[],
    latestChecks?:ITradleCheck[]
    templates?: any[]}
    ) {

    let soChecks = []
    for (let checkId in signoffChecks) {
      let resource: any = {
        [TYPE]: checkId,
        status: 'pending',
        application,
        dateChecked: new Date().getTime(),
        aspects: signoffChecks[checkId],
      }
      if (templates && templates.length) {
        let templateName = checkId.split('.').pop()
        let template = templates.find(t => t.html.split('.')[0] === templateName)
        if (template) {
          this.logger.debug(`found template: ${template.title}`)
          let link = appLinks.getResourceLink({
            type: application[TYPE],
            baseUrl: '',
            platform: 'web',
            permalink: application._permalink,
            link: application._link,
          })
          resource.documentToBeNotarised = `${link}&-template=${encodeURIComponent(template.title)}`
        }
      }
      this.logger.debug(`creating ${checkId}`)
      soChecks.push(this.applications.createCheck(resource, {application, checks, latestChecks}))
    }
    return await Promise.all(soChecks)
  }

}
export const createPlugin: CreatePlugin<void> = (components, { conf, logger }) => {
  const { bot, applications, conf:botConf } = components
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
      if (!application) return
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
      await WorkflowSignoff.checkAndCreate({application, templates})
      // let resource: any = {
      //   [TYPE]: checkId,
      //   status: 'pending',
      //   application,
      //   dateChecked: new Date().getTime(),
      //   aspects: signoffChecks[checkId],
      // }
      // logger.debug(`creating ${checkId}`)
      // await applications.createCheck(resource, {application})     
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
      // let message = 'All credit committee checks should be overwritten before application can be approved'
        // if (!checksOverride) 
      //   throw new Error(message) 

      // let signOffChecksOverrideTypes =  Object.keys(signoffChecks).map(sc => `${sc}Override`)
      // let signOffChecksOverrideTypesCount = signOffChecksOverrideTypes.length

      // let signoffChecksOverride = checksOverride.filter(co => signOffChecksOverrideTypes.indexOf(co[TYPE]) !== -1)
      // if (signoffChecksOverride.length < signOffChecksOverrideTypesCount) return

      // const { models } = bot
      // signoffChecksOverride = await Promise.all(signoffChecksOverride.map(so => bot.getResource(so)))
      // signoffChecksOverride.sort((a, b) => b._time - a._time)
      // signoffChecksOverride = uniqBy(signoffChecksOverride, TYPE)

      // signoffChecksOverride = signoffChecksOverride.filter(so => getEnumValueId({model: models[OVERRIDE_STATUS], value: so.status}) !== 'pass')
      // if (!signoffChecksOverride.length) return
      // if (req)
      //   await bot.sendSimpleMessage({ to: user, message })
      // throw new Error(message)
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