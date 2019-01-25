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
    let aApp, checkIfAllFormsSubmitted = true
    if (application.requestFor === this.conf.parent) {
      aApp = application
      checkIfAllFormsSubmitted = false
    }
    else {
      const pr:ITradleObject = await this.bot.getResource(application.request)
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
    const submissions:any[] = appSubmissions.submissions
    if (!submissions.length)
      return

    if (checkIfAllFormsSubmitted) {
      let parentProductID = makeProductModelID(this.conf.parent)
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
    if (!items  ||  !items.length) {
      this.logger.debug('Child applications were not submitted yet. Nothing further to check')
      return
    }
    if (items.length < cp.length) {
      this.logger.debug('The number of submitted child applications is not the same as emails that were sent out. Nothing further to check')
      return
    }

    const prReq:ITradleObject[] = items;

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


    if (!items  ||  !items.length) {
      this.logger.debug('Something wrong PR for child applications found and Applications for these PRs are not!!! Something is screwed')
      return
    }

    const appsForCP:ITradleObject[] = items;

    const requests = appsForCP.map(app => this.bot.getResource(app, { backlinks: ['products'] }))
    const results:ITradleObject[] = await Promise.all(requests)
debugger
    if (!results) {
      this.logger.debug('Child applications were not approved yet. Nothing further to check')
      return
    }
    let childProductId = makeProductModelID(this.conf.child)

    const products = results.filter(r => r.products  &&  r.products.filter(rr => rr.submission[TYPE] === childProductId))

    if (!products.length  ||  products.length < cp.length) {
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
      let childProduct = makeProductModelID(conf.child)
debugger
      if (certificate[TYPE] === childProduct) {
        logger.debug('New child application was approved. Check if parent application can be auto-approved')
        await autoApproveAPI.checkCPs(opts.application)
      }
    },
    // check if auto-approve ifvapplication Legal entity product was submitted
    onFormsCollected: async ({req}) => {
debugger
      const { application } = req
      if (application.requestFor !== conf.parent)
        return
      logger.debug('Parent application was submitted. Check if all child applications checked in')
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
