// import _ from 'lodash'
// import validateResource from '@tradle/validate-resource'
import { TYPE } from '@tradle/constants'
import {
  isPassedCheck
} from '../utils'
import {
  Bot,
  CreatePlugin,
  IPluginLifecycleMethods,
  ValidatePluginConf,
  ITradleCheck,
  IPBApp,
  Applications
} from '../types'

// const { parseStub } = validateResource.utils

// export const name = 'conditional-auto-approve'

interface IConditionalAutoApproveConf {
  [product: string]: {
    [targetCheck: string]: string []
  }
}

type ConditionalAutoApproveOpts = {
  bot: Bot
  conf: IConditionalAutoApproveConf,
  applications: Applications
}

export class ConditionalAutoApprove {
  private bot: Bot
  private conf: IConditionalAutoApproveConf
  private applications:Applications
  constructor({ bot, conf, applications }: ConditionalAutoApproveOpts) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
  }

  public checkTheChecks = async ({ check }) => {
    let application = await this.bot.getResource(check.application, {backlinks: ['checks']})
    let product = application.requestFor

    let checksToCheck = this.conf.products[product]
    if (!checksToCheck)
      return
    const thisCheckType = check[TYPE]
// debugger
    if (!checksToCheck.includes(thisCheckType))
      return
    const checkResources = await this.applications.getLatestChecks({ application })
    const foundChecks = checkResources.filter(check => {
      debugger
      let isPassed = isPassedCheck({status: check.status})
      return (isPassed                 &&
        checksToCheck.includes(check[TYPE])
      )
    })
    if (foundChecks.length !== checksToCheck.length)
      return
// debugger
    await this.applications.approve({ application })
  }
}

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const autoApproveAPI = new ConditionalAutoApprove({ bot, conf, applications })
  const plugin: IPluginLifecycleMethods = {
    onCheckStatusChanged: async function(check: ITradleCheck) {
      if (isPassedCheck(check))
        await autoApproveAPI.checkTheChecks({ check })
    }
  }

  return { plugin }
}

export const validateConf:ValidatePluginConf = async ({ bot, conf, pluginConf }) => {
  const { models } = bot
  // debugger
  for (let appType in <IConditionalAutoApproveConf>pluginConf) {
    let checks = pluginConf[appType]
    for (let target in checks) {
      if (!models[target]) throw new Error(`missing model: ${target}`)

      let sources = checks[target]
      sources.forEach(source => {
        if (!models[source]) throw new Error(`missing model: ${source}`)
      })
    }
  }
}
