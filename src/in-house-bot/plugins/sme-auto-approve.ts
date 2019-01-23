// import _ from 'lodash'
// import validateResource from '@tradle/validate-resource'
import { TYPE } from '@tradle/constants'
import {
  Bot,
  CreatePlugin,
  IWillJudgeAppArg,
  IPluginLifecycleMethods,
  ValidatePluginConf,
  ITradleObject,
  IPBApp,
  Applications,
  Logger,
} from '../types'
const MY_CP_PRODUCT = 'tradle.legal.MyControllingPersonOnboarding'
const CP = 'tradle.legal.LegalEntityControllingPerson'
const PRODUCT_REQUEST = 'tradle.ProductRequest'
const APPLICATION = 'tradle.Application'
const APPLICATION_SUBMITTED = 'tradle.ApplicationSubmitted'
const LEGAL_ENTITY_PRODUCT = 'tradle.legal.LegalEntityProduct'
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

  public checkCPs = async (application) => {
    this.logger.debug('checking if all CPs checked in')

    let aApp, checkIfAllFormsSubmitted = true
    if (application.requestFor === this.conf.parent) {
      aApp = application
      checkIfAllFormsSubmitted = false
    }
    else{
      const pr = await this.bot.getResource(application.request)
      const associatedResource = pr.associatedResource
      // const asociatedApplication = await this.bot.getResource(associatedResource, {backlinks: ['forms']})
      const associatedApplication = await this.bot.db.find({
        filter: {
          EQ: {
           [TYPE]: APPLICATION,
           _permalink: associatedResource
          }
        }
      })
      aApp = associatedApplication  &&  associatedApplication.items  &&  associatedApplication.items[0]
    }
    const appSubmissions = await this.bot.getResource(aApp, {backlinks: ['submissions']})
debugger

    // let forms = aApp.forms
    if (!appSubmissions)
      return
    const submissions = appSubmissions.submissions
    if (!submissions.length)
      return

    if (checkIfAllFormsSubmitted) {
      let parentProductID = makeProductModelID(this.conf.parent)
      let appApproved = submissions.filter(f => f.submission[TYPE] === parentProductID)
      if (appApproved.length)
        return
      let appSubmitted = submissions.filter(f => f.submission[TYPE] === APPLICATION_SUBMITTED)
      if (!appSubmitted.length)
        return
    }

    let cp = submissions.filter(f => f.submission[TYPE] === CP)
    if (!cp.length)
      return

    let { items } = await this.bot.db.find({
      filter: {
        EQ: {
         [TYPE]: PRODUCT_REQUEST,
         'associatedResource': aApp._permalink,
        }
      }
    })
    if (!items  ||  !items.length)
      return
    if (items.length < cp.length)
      return

    const prReq:any = items;

    ({ items } = await this.bot.db.find({
      filter: {
        EQ: {
         [TYPE]: APPLICATION
        },
        IN: {
          'context': prReq.map(r => r.contextId)
        }
      }
    }));


    if (!items  ||  !items.length)
      return

    const appsForCP:any = items;

    const requests = appsForCP.map(app => this.bot.getResource(app, { backlinks: ['products'] }))
    const results:any = await Promise.all(requests)
debugger
    if (!results)
      return
    let childProductId = makeProductModelID(this.conf.child)

    const products = results.filter(r => r.products  &&  r.products.filter(rr => rr.submission[TYPE] === childProductId))

    if (!products.length  ||  products.length < cp.length)
      return
    this.logger.debug('auto-approving application')

    await this.applications.approve({ application: aApp })
  }
}

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const autoApproveAPI = new SmeAutoApprove({ bot, conf, applications, logger })
// debugger
  const plugin: IPluginLifecycleMethods = {
    didApproveApplication: async (opts: IWillJudgeAppArg, certificate: ITradleObject) => {
      let childProduct = makeProductModelID(conf.child)
debugger
      if (certificate[TYPE] === childProduct)
        await autoApproveAPI.checkCPs(opts.application)
    },
    // check if auto-approve ifvapplication Legal entity product was submitted
    onFormsCollected: async ({req}) => {
debugger
      const { application } = req
      if (application.requestFor !== conf.parent)
        return
      await autoApproveAPI.checkCPs(application)
    }
  }

  return { plugin }
}
function makeProductModelID(modelId) {
  let parts = modelId.split('.')
  parts[parts.length - 1] = 'My' + parts[parts.length - 1]
  return parts.join('.')
}
export const validateConf:ValidatePluginConf = async ({ bot, conf, pluginConf }) => {
  const { models } = bot
  // debugger
  for (let appType in <ISmeConf>pluginConf) {
    let child = pluginConf.child
    if (!child)
      throw new Error('missing child')
    if (!models[child])
      throw new Error(`there is no model: ${child}`)

    let parent = pluginConf.parent
    if (!parent)
      throw new Error('missing parent')
    if (!models[parent])
      throw new Error(`there is no model: ${parent}`)
  }
}
