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
  public async checkAndAutoapprove({application, forms, checks}) {
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
    if (!latestChecks) return
    let foundChecks = 0
    for (let i = 0; i < latestChecks.length; i++) {
      let c = latestChecks[i]
      if (checks  &&  !checks.includes(c[TYPE])) continue
      if (EXCLUDE_CHECKS.includes(c[TYPE])) continue
      foundChecks++
      if (c.status === undefined || isPassedCheck({status: c.status})) continue

      if (!checkOverridesStubs) return false
      if (!checkOverrides) 
        checkOverrides = await Promise.all(checkOverridesStubs.map(stub => this.bot.getResource(stub)))

      let checkOverride = checkOverrides.find(co => co.check._link === c._link)
      if (!checkOverride) return false
      
      let checkOverrideType = `${c[TYPE]}Override`
      let co = checkOverrides.find(co => co[TYPE] === checkOverrideType)
      if (!co || getEnumValueId({ model: this.bot.models[OVERRIDE_STATUS], value: co.status }) !== 'pass') return     
    }

    if (checks) {
      if (foundChecks !== checks.length) return false
    }
    return true
  }
  // public checkTheChecks = async ({ check }) => {
  //   this.logger.debug('checking if all checks passed')
  //   const application = await this.bot.getResource(check.application, { backlinks: ['forms'] })
  //   if (application.draft) return
  //   const product = application.requestFor

  //   const checksToCheck = this.conf.products[product]
  //   if (!checksToCheck) {
  //     this.logger.debug(`not configured for product: ${product}`)
  //     return
  //   }

  //   const thisCheckType = check[TYPE]
  //   if (checksToCheck.length && !checksToCheck.includes(thisCheckType)) {
  //     this.logger.debug(`ignoring check ${thisCheckType}, not relevant for auto-approve`)
  //     return
  //   }

  //   // Check if all forms submitted
  //   const productForms = this.bot.models[product].forms
  //   let formsSubmitted = []
  //   let forms = application.submissions.filter(f => {
  //     if (productForms.include(f[TYPE]) && !formsSubmitted.includes(f[TYPE]))
  //       formsSubmitted.push(f[TYPE])
  //   })
  //   if (forms.length !== productForms.length) return
  //   let { latestChecks } = await getLatestChecks({ application, bot: this.bot })
  //   // check that just passed may not have had correponding ApplicationSubmission created yet
  //   // and so may not be in the result
  //   const idx = latestChecks.findIndex((c: any) => c._permalink === check._permalink)
  //   if (idx === -1) {
  //     latestChecks.push(check)
  //   } else {
  //     latestChecks[idx] = check
  //   }

  //   const foundChecks = latestChecks.filter((check: any) => {
  //     return isPassedCheck(check) && checksToCheck.includes(check[TYPE])
  //   })

  //   if (foundChecks.length !== checksToCheck.length) {
  //     this.logger.debug('not ready to auto-approve', {
  //       product,
  //       passed: foundChecks.map(getResourceType),
  //       required: checksToCheck.map(getResourceType)
  //     })

  //     return
  //   }

  //   this.logger.debug('auto-approving application')
  //   await this.applications.approve({ application })
  // }
}

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const autoApproveAPI = new ConditionalAutoApprove({ bot, conf, applications, logger })
  const plugin: IPluginLifecycleMethods = {
    // onCheckStatusChanged: async (check: ITradleCheck) => {
    //   // check only if check changed not for new check
    //   if (!check._prevlink || !isPassedCheck(check)) return

    //   // debugger
    //   await autoApproveAPI.checkTheChecks({ check })
    // },
    onFormsCollected: async function({ req }) {
      if (req.skipChecks) {
        logger.debug('skipped, skipChecks=true')
        return
      }
      const { application } = req
      if (!application || application.draft || application.status === 'approved') return

      let productConf = conf.products[application.requestFor]
      if (!productConf) return

      if (await autoApproveAPI.checkAndAutoapprove({ application, ...productConf }))
        await applications.approve({ req, application })  
    },
    onmessage: async function(req) {
      if (req.skipChecks) {
        logger.debug('skipped, skipChecks=true')
        return
      }
      const { application, payload } = req
      if (!application || application.draft || application.status === 'approved') return
      if (!isSubClassOf(CHECK_OVERRIDE, bot.models[payload[TYPE]], bot.models)) return

      let productConf = conf.products[application.requestFor]
      if (!productConf) return

      if (await autoApproveAPI.checkAndAutoapprove({ application, ...productConf }))
        await applications.approve({ req, application })  
    },
    async willApproveApplication (opts: IWillJudgeAppArg) {
      const { req, application } = opts
      if (!application || application.draft || application.status === 'approved') return
      let { requestFor } = application

      const productConf = conf.products[requestFor]
      if (!productConf) return 

      let approved = await autoApproveAPI.checkAndAutoapprove({ application, ...productConf })
      if (!approved) {
        throw new Errors.AbortError('Something is not yet resolved')
        // if (req)
        //   await bot.sendSimpleMessage({ to: req.user, message: 'Not all conditions are met for approval' })
      }
        
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
