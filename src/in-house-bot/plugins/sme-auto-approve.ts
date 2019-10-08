import _ from 'lodash'
// import validateResource from '@tradle/validate-resource'
import { TYPE } from '@tradle/constants'
import { buildResourceStub } from '@tradle/build-resource'
import {
  Bot,
  CreatePlugin,
  IWillJudgeAppArg,
  IPBReq,
  IPluginLifecycleMethods,
  ValidatePluginConf,
  ITradleObject,
  IPBApp,
  Applications,
  Logger
} from '../types'

const CP = 'tradle.legal.LegalEntityControllingPerson'
const PRODUCT_REQUEST = 'tradle.ProductRequest'
const APPLICATION = 'tradle.Application'
const APPLICATION_SUBMITTED = 'tradle.ApplicationSubmitted'
// const { parseStub } = validateResource.utils

// export const name = 'conditional-auto-approve'

const getResourceType = resource => resource[TYPE]

type SmeAutoApproveOpts = {
  bot: Bot
  conf: ISmeConf
  applications: Applications
  logger: Logger
}
interface ISmeConf {
  parent: string
  child: string
}

export class SmeAutoApprove {
  private bot: Bot
  private conf: ISmeConf
  private applications: Applications
  private logger: Logger
  constructor({ bot, conf, applications, logger }: SmeAutoApproveOpts) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
    this.logger = logger
  }

  public checkCPs = async application => {
    let aApp,
      checkIfAllFormsSubmitted = true
    if (application.parent) {
      aApp = await getAssociateResources({ application, bot: this.bot, applicationOnly: true })
      aApp = aApp.parentApplication
    } else {
      aApp = application
      checkIfAllFormsSubmitted = false
    }
    const appSubmissions = await this.bot.getResource(aApp, { backlinks: ['submissions'] })
    // debugger

    if (!appSubmissions) return
    const submissions: any[] = appSubmissions.submissions
    if (!submissions.length) return

    if (checkIfAllFormsSubmitted) {
      let parentProductID = makeMyProductModelID(aApp.requestFor)
      let appApproved = submissions.filter(f => f.submission[TYPE] === parentProductID)
      if (appApproved.length) {
        this.logger.debug('Parent application was approved. Nothing further to check')
        return
      }
      let appSubmitted = submissions.filter(f => f.submission[TYPE] === APPLICATION_SUBMITTED)
      if (!appSubmitted.length) {
        this.logger.debug('Parent application was not finished. Nothing yet to check')
        return
      }
    }

    let cp = submissions.filter(f => f.submission[TYPE] === CP)
    if (!cp.length) return

    let { items } = await this.bot.db.find({
      filter: {
        EQ: {
          [TYPE]: PRODUCT_REQUEST,
          parentApplication: aApp._permalink
        }
      }
    })
    if (!items || !items.length) {
      this.logger.debug('Child applications were not submitted yet. Nothing further to check')
      return
    }
    if (items.length < cp.length) {
      this.logger.debug(
        'The number of submitted child applications is not the same as emails that were sent out. Nothing further to check'
      )
      return
    }

    const prReq: ITradleObject[] = items
    ;({ items } = await this.bot.db.find({
      filter: {
        EQ: {
          [TYPE]: APPLICATION
        },
        IN: {
          context: prReq.map(r => r.contextId)
        }
      }
    }))

    if (!items || !items.length) {
      this.logger.debug(
        'Something wrong PR for child applications found and Applications for these PRs are not!!! Something is screwed'
      )
      return
    }

    const appsForCP: ITradleObject[] = items

    const requests = appsForCP.map(app => this.bot.getResource(app, { backlinks: ['products'] }))
    const results: ITradleObject[] = await Promise.all(requests)
    // debugger
    if (!results) {
      this.logger.debug('Child applications were not approved yet. Nothing further to check')
      return
    }
    let childProductId = makeMyProductModelID(this.conf.child)

    const products = results.filter(
      r => r.products && r.products.filter(rr => rr.submission[TYPE] === childProductId)
    )
    if (!aApp.chileApps || aApp.childApps.length < items.length)
      aApp.childApps = items.map(a => buildResourceStub({ resource: a, models: this.bot.models }))
    if (!products.length || products.length < cp.length) {
      this.logger.debug('Not all child applications were approved yet. Nothing further to check')
      return
    }
    this.logger.debug('auto-approving application')

    await this.applications.approve({ application: aApp })
  }
}

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const autoApproveAPI = new SmeAutoApprove({ bot, conf, applications, logger })
  // debugger
  const plugin: IPluginLifecycleMethods = {
    didApproveApplication: async (opts: IWillJudgeAppArg, certificate: ITradleObject) => {
      let { application } = opts
      if (!application || !conf.pairs) return
      let parent = application.parent
      if (!parent) return
      let { requestFor } = application
      if (!parent.requestFor) {
        parent = await bot.getResource(parent)
      }

      let pairs = conf.pairs.filter(
        pair => requestFor === pair.child && parent.requestFor === pair.parent
      )
      if (!pairs.length) return

      let childProduct = makeMyProductModelID(pairs[0].child)
      // debugger
      if (certificate[TYPE] === childProduct) {
        logger.debug(
          'New child application was approved. Check if parent application can be auto-approved'
        )
        await autoApproveAPI.checkCPs(application)
      }
    },
    // check if auto-approve ifvapplication Legal entity product was submitted
    onFormsCollected: async ({ req }) => {
      // debugger
      const { application } = req
      if (!application || !conf.pairs) return
      const { requestFor } = application

      let pairs = conf.pairs.filter(pair => requestFor === pair.parent)

      debugger
      if (pairs.length) {
        logger.debug('Parent application was submitted. Check if all child applications checked in')
        await autoApproveAPI.checkCPs(application)
      }
    },
    async onmessage(req: IPBReq) {
      // debugger
      const { application } = req
      if (!application || application.parent || !application.forms || !conf.pairs) return
      const { requestFor } = application

      let pairs = conf.pairs.filter(pair => requestFor === pair.child)

      if (!pairs.length) return
      logger.debug('Child application was submitted')
      let { parentApp, associatedRes } = await getAssociateResources({ application, bot })
      if (!parentApp) return
      // pairs = pairs.find(pair => pair.parent === parentApp.requestFor)
      // if (!pairs)
      //   return
      // debugger
      // application.parent = parentApp
      let stub = buildResourceStub({ resource: parentApp, models: bot.models })
      application.parent = stub
      application.top = parentApp.top || stub

      application.associatedResource = buildResourceStub({
        resource: associatedRes,
        models: bot.models
      })

      debugger
    }
  }

  return { plugin }
}

export const validateConf: ValidatePluginConf = async ({ bot, conf, pluginConf }) => {
  const { models } = bot
  debugger
  if (!pluginConf.pairs) throw new Error(`there is no 'pairs' in conf`)
  if (!Array.isArray(pluginConf.pairs)) throw new Error(`'pairs' should be an array in conf`)
  if (!pluginConf.pairs.length) throw new Error(`'pairs' is empty in conf`)
  pluginConf.pairs.forEach(pair => {
    for (let appType in pair as ISmeConf) {
      let child = pair.child
      if (!child) throw new Error('missing child')
      if (!models[child]) throw new Error(`there is no model: ${child}`)

      let parent = pair.parent
      if (!parent) throw new Error('missing parent')
      if (!models[parent]) throw new Error(`there is no model: ${parent}`)
    }
  })
}

function makeMyProductModelID(modelId) {
  let parts = modelId.split('.')
  parts[parts.length - 1] = 'My' + parts[parts.length - 1]
  return parts.join('.')
}
async function getAssociateResources({
  application,
  bot,
  applicationOnly
}: {
  application: IPBApp
  bot: Bot
  applicationOnly?: boolean
}) {
  const pr: ITradleObject = await bot.getResource(application.request)
  const { parentApplication, associatedResource } = pr
  if (!parentApplication) return {}
  // const asociatedApplication = await this.bot.getResource(associatedResource, {backlinks: ['forms']})
  let parentApp = await bot.db.findOne({
    filter: {
      EQ: {
        [TYPE]: APPLICATION,
        _permalink: parentApplication
      }
    }
  })
  if (applicationOnly) return { parentApp }
  let [type, hash] = associatedResource.split('_')
  // const asociatedApplication = await this.bot.getResource(associatedResource, {backlinks: ['forms']})
  let associatedRes = await bot.db.findOne({
    filter: {
      EQ: {
        [TYPE]: type,
        _permalink: hash
      }
    }
  })
  return { associatedRes, parentApp }
}
