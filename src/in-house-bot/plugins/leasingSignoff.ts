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
const STATUS = 'tradle.Status'
const OVERRIDE_STATUS = 'tradle.OverrideStatus'

class LeasingSignoffAPI {
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
  public async checkAndCreate({application}) {
    const { bot, conf, logger } = this
    let { checks, checksOverride, requestFor } = application
    const productConf = conf.products[requestFor]
    if (!productConf) return

    let { signoffChecks } = productConf
    if (!signoffChecks) return
    const { models } = this.bot

    if (!checks) {
      return await this.createSignoffChecks({application, signoffChecks})
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
      let status = getEnumValueId({model: models[STATUS], value: check.status})
      if (status === 'pass') continue

      let override = checksOverride && checksOverride.find(co => co[TYPE] === `${checkType}Override`)
      if (!override) {
        logger.debug(`No check override for failed ${models[checkType].title}`)
        return
      }
      if (getEnumValueId({model: models[OVERRIDE_STATUS], value: override.status}) !== 'pass') return         
    }
    return await this.createSignoffChecks({application, signoffChecks, checks, latestChecks})
  }
  async createSignoffChecks({application, signoffChecks, checks, latestChecks}:{
    application: IPBApp, 
    signoffChecks:any, 
    checks?:ITradleCheck[], 
    latestChecks?:ITradleCheck[]}
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
      this.logger.debug(`creating ${checkId}`)
      soChecks.push(this.applications.createCheck(resource, {application, checks, latestChecks}))                
    }
    return await Promise.all(soChecks)
  }

}
export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const leasingSignoff = new LeasingSignoffAPI({ bot, conf, applications, logger })
  const plugin: IPluginLifecycleMethods = {
    async onFormsCollected({ req }) {
      const { application } = req
      if (!application ||  application.status === 'approved') return
      if (application.processingDataBundle ||
          application.draft) return

      await leasingSignoff.checkAndCreate({application})     
    },
    async onResourceChange({ old, value }) {
      const { models } = bot
      if (!isSubClassOf('tradle.CheckOverride', models[value[TYPE]], models)) return
      if (getEnumValueId({model: models[OVERRIDE_STATUS], value: value.status}) !== 'pass') return         
      
      let application = await bot.getResource(value.application, {backlinks: ['checks', 'checksOverride']})
      let { requestFor } = application
      if (!conf[requestFor]) return
      const productConf = conf[requestFor]
      if (!productConf) return  
      await leasingSignoff.checkAndCreate({application})     
    },
    // async didApproveApplication (opts: IWillJudgeAppArg, certificate: ITradleObject) {
    //   const { application } = opts
    //   let { checksOverride, requestFor } = application
    //   if (!checksOverride) return
    //   const productConf = conf[requestFor]
    //   if (!productConf) return
  
    //   let { signoffChecks } = productConf
    //   if (!signoffChecks) return
    //   let signOffChecksOverrideTypes =  Object.keys(signoffChecks).map(sc => sc[TYPE] === `${sc}Override`)
    //   let signOffChecksOverrideTypesCount = signOffChecksOverrideTypes.length

    //   let signoffChecksOverride = checksOverride.filter(co => signOffChecksOverrideTypes.indexOf(co[TYPE]) !== -1)
    //   if (signoffChecksOverride.length < signOffChecksOverrideTypesCount) return
      
    //   const { models } = bot
    //   signoffChecksOverride = await Promise.all(signoffChecksOverride.map(so => bot.getResource(so)))
    //   signoffChecksOverride = signoffChecksOverride.filter(so => getEnumValueId({model: models[OVERRIDE_STATUS], value: so.status}) !== 'pass')         
    //   if (!signoffChecksOverride.length)
    //     await this.applications.approve({ application })   
    // }
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