// import _ from 'lodash'
// import validateResource from '@tradle/validate-resource'
import { TYPE } from '@tradle/constants'
import { isPassedCheck, isSubClassOf } from '../utils'
import { getEnumValueId, getLatestChecks } from '../utils'
import Errors from '../../errors'
import {
  Bot,
  CreatePlugin,
  IPluginLifecycleMethods,
  ValidatePluginConf,
  ITradleCheck,
  IPBApp,
  Applications,
  Logger,
  IWillJudgeAppArg
} from '../types'

// export const name = 'conditional-auto-approve'
const CHECK_OVERRIDE = 'tradle.CheckOverride'
const OVERRIDE_STATUS = 'tradle.OverrideStatus'
const EXCLUDE_CHECKS = [
  'tradle.EmailCheck',
  'tradle.PhoneCheck',
  'tradle.ClientEditsCheck'
]
// interface IConditionalAutoApproveConf {
//   [product: string]: {
//     [targetCheck: string]: string[]
//   }
// }

type ConditionalAutoApproveOpts = {
  bot: Bot
  conf: any
  applications: Applications
  logger: Logger
}

export class ConditionalAutoApprove {
  private bot: Bot
  private conf: any //IConditionalAutoApproveConf
  private applications: Applications
  private logger: Logger
  constructor({ bot, conf, applications, logger }: ConditionalAutoApproveOpts) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
    this.logger = logger
  }
  public async checkAndAutoapprove({application, newCheckOverride, forms, checks}) {
    if (forms) {
      for (let ff in forms) {
        // let [f, p] = ff.split('^')
        let p = forms[ff]
        let form = application.forms.find(stub => stub.submission[TYPE] === ff)
        if (!form) return false
        form = await this.bot.getResource(form.submission)
        if (!form[p]) return false
      }
    }
    let { checksOverride: checkOverridesStubs } = application
    let checkOverrides
    // if (checkTypes.length) {
    // let latestChecks: any = req.latestChecks
    // if (!latestChecks) ({ latestChecks } = await getLatestChecks({ application, bot: this.bot }))
    const { latestChecks } = await getLatestChecks({ application, bot: this.bot })

    if (!latestChecks) return true
  this.logger.debug(`checks to check: ${latestChecks.length}`)

    let foundChecks = 0
    for (let i = 0; i < latestChecks.length; i++) {
      let c = latestChecks[i]
      if (checks  &&  !checks.includes(c[TYPE])) continue
      if (EXCLUDE_CHECKS.includes(c[TYPE])) continue
      foundChecks++
      if (c.status === undefined || isPassedCheck({status: c.status})) continue

      if (!checkOverridesStubs)       
      if (!checkOverridesStubs && !newCheckOverride) return false
      if (checkOverridesStubs) {
        if (!checkOverrides)
          checkOverrides = await Promise.all(checkOverridesStubs.map(stub => this.bot.getResource(stub)))
          if (newCheckOverride)
            checkOverrides.push(newCheckOverride)  
      }
      else 
        checkOverrides = [newCheckOverride]
      
      let checkOverride = checkOverrides.find(co => co.check._link === c._link)
      if (!checkOverride) return false

      let co = checkOverrides.find(co => co.check[TYPE] === c[TYPE])
      if (!co || getEnumValueId({ model: this.bot.models[OVERRIDE_STATUS], value: co.status }) !== 'pass') return
    }

    if (checks) {
      if (foundChecks !== checks.length) 
        return false
    }
    return true
  }
}

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const autoApproveAPI = new ConditionalAutoApprove({ bot, conf, applications, logger })
  const plugin: IPluginLifecycleMethods = {
    onFormsCollected: async function({ req }) {
      if (req.skipChecks) {
        logger.debug('skipped, skipChecks=true')
        return
      }
      const { application } = req
      if (!application  ||  /* application.draft  || */  application.status === 'approved') return

      let productConf = conf.products[application.requestFor]
      if (!productConf) return

      if (await autoApproveAPI.checkAndAutoapprove({ application, ...productConf })) {
        req.conditionalApproval = true
        await applications.approve({ req, application })
      }
    },
    onmessage: async function(req) {
      if (req.skipChecks) {
        logger.debug('skipped, skipChecks=true')
        return
      }
      const { application, payload } = req
      if (!application || /* application.draft ||*/ application.status === 'approved') return
      if (!isSubClassOf(CHECK_OVERRIDE, bot.models[payload[TYPE]], bot.models)) return
      if (getEnumValueId({ model: bot.models[OVERRIDE_STATUS], value: payload.status }) !== 'pass') return

      let productConf = conf.products[application.requestFor]
      if (!productConf) return

      if (await autoApproveAPI.checkAndAutoapprove({ application, newCheckOverride: payload, ...productConf })) {
        req.conditionalApproval = true
        await applications.approve({ req, application })
      }
    },
    async willApproveApplication (opts: IWillJudgeAppArg) {
      const { req, application } = opts
      if (!application || /* application.draft ||*/ application.status === 'approved') return
      let { requestFor } = application

      const productConf = conf.products[requestFor]
      if (!productConf) return
      if (req.conditionalApproval) return
      let approved = await autoApproveAPI.checkAndAutoapprove({ application, ...productConf })
      if (!approved) 
        throw new Errors.AbortError('Something is not yet resolved')      
    }
  }

  return { plugin }
}

export const validateConf: ValidatePluginConf = async ({ bot, conf, pluginConf }) => {
  const { models } = bot
  // debugger
  for (let appType in pluginConf) {
    let { checks, forms } = pluginConf[appType]
    if (!checks  &&  !forms) return
    if (!checks) checks = {}
    for (let target in checks) {
      if (!models[target]) throw new Error(`missing model: ${target}`)

      let sources = checks[target]
      sources.forEach(source => {
        if (!models[source]) throw new Error(`missing model: ${source}`)
      })
    }
    if (!forms) forms = {}
    if (Object.keys(forms).length > 1) throw new Error(`Only one property should be an indicator for auto-approve`)
    for (let ff in forms) {
      let m = models[ff]
      if (!m) throw new Error(`missing model: ${ff}`)
      let p = forms[ff]
      if (!m[p]) throw new Error(`missing property ${p} in model ${ff}`)
    }
  }
}
