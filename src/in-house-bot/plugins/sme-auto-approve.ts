import _ from 'lodash'
// import validateResource from '@tradle/validate-resource'
import { TYPE } from '@tradle/constants'
import { buildResourceStub, enumValue } from '@tradle/build-resource'
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
import { getAssociateResources } from '../utils'
import { valueFromAST } from 'graphql'

const CP = 'tradle.legal.LegalEntityControllingPerson'
// const LEGAL_ENTITY = 'tradle.legal.LegalEntity'
const PRODUCT_REQUEST = 'tradle.ProductRequest'
const APPLICATION = 'tradle.Application'
const APPLICATION_SUBMITTED = 'tradle.ApplicationSubmitted'
const NOTIFICATION_STATUS = 'tradle.NotificationStatus'
const NOTIFICATION = 'tradle.Notification'

const getResourceType = resource => resource[TYPE]

type SmeVerifierOpts = {
  bot: Bot
  conf: ISmeConf
  applications: Applications
  logger: Logger
}
interface ISmeConf {
  parent: string
  child: string
}

export class SmeVerifier {
  private bot: Bot
  private conf: ISmeConf
  private applications: Applications
  private logger: Logger
  constructor({ bot, conf, applications, logger }: SmeVerifierOpts) {
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
      aApp = aApp.parentApp
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
  public async checkAndUpdateNotification(application) {
    let { parent, associatedResource } = application
    let parentNotifications = await this.bot.getResource(parent, {
      backlinks: ['notifications']
    })
    let notifications = parentNotifications.notifications
    if (!notifications) return
    // debugger
    notifications = await Promise.all(notifications.map(r => this.bot.getResource(r)))
    let notification = notifications.find(
      (r: any) => r.form._permalink === associatedResource._permalink
    )
    if (!notification) return
    let statusId = notification.status.id
    if (statusId.endsWith('_inProgress')) return
    let isStarted = application.forms.length === 1
    let status = (isStarted && 'started') || 'inProgress'
    let timesNotified = 1
    await this.bot.versionAndSave({
      ...notification,
      dateLastNotified: Date.now(),
      timesNotified,
      status: enumValue({ model: this.bot.models[NOTIFICATION_STATUS], value: status })
    })
  }
}

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const smeVerifierAPI = new SmeVerifier({ bot, conf, applications, logger })
  // debugger
  const plugin: IPluginLifecycleMethods = {
    didApproveApplication: async (opts: IWillJudgeAppArg, certificate: ITradleObject) => {
      let { application } = opts
      if (!application || !conf.length) return
      let parent = application.parent
      if (!parent) return
      let { requestFor } = application
      if (!parent.requestFor) {
        parent = await bot.getResource(parent)
      }

      let pairs = conf.filter(
        pair => requestFor === pair.child && parent.requestFor === pair.parent
      )
      if (!pairs.length) return

      let childProduct = makeMyProductModelID(pairs[0].child)
      // debugger
      if (certificate[TYPE] === childProduct) {
        logger.debug(
          'New child application was approved. Check if parent application can be auto-approved'
        )
        await smeVerifierAPI.checkCPs(application)
      }
    },
    // check if auto-approve ifvapplication Legal entity product was submitted
    onFormsCollected: async ({ req }) => {
      // debugger
      const { application } = req
      if (!application || !conf.length || application.draft) return
      const { requestFor } = application

      let pairs = conf.filter(pair => requestFor === pair.parent)

      // debugger
      if (pairs.length) {
        logger.debug('Parent application was submitted. Check if all child applications checked in')
        await smeVerifierAPI.checkCPs(application)
        return
      }
      pairs = conf.filter(pair => requestFor === pair.child && pair.parent !== pair.child)
      let { parent, associatedResource } = application
      if (!parent || !associatedResource) return
      parent = await bot.getResource(parent)
      let pair = conf.find(pair => requestFor === pair.child && pair.parent === parent.requestFor)
      if (!pair) return

      let appWithNotifications = await bot.getResource(parent, { backlinks: ['notifications'] })
      let { notifications } = appWithNotifications
      if (!notifications || !notifications.length) return

      let notification = await bot.db.findOne({
        filter: {
          EQ: {
            [TYPE]: NOTIFICATION,
            'application._permalink': parent._permalink,
            'form._permalink': associatedResource._permalink
          },
          NEQ: {
            status: `${NOTIFICATION_STATUS}_completed`
          }
        }
      })

      if (notification)
        await bot.versionAndSave({
          ...notification,
          // dateLastModified: Date.now(),
          status: enumValue({ model: bot.models[NOTIFICATION_STATUS], value: 'completed' })
        })
    },
    async onmessage(req: IPBReq) {
      // debugger
      const { application, payload } = req
      if (!application || !application.forms || !conf.length || application.draft) return

      if (application.parent) {
        await smeVerifierAPI.checkAndUpdateNotification(application)
        return
      }
      const { requestFor } = application

      let pairs = conf.filter(pair => requestFor === pair.child)

      if (!pairs.length) return
      logger.debug('Child application was submitted')
      let { parentApp, associatedRes } = await getAssociateResources({ application, bot })
      if (!parentApp) {
        if (!application.tree) {
          application.tree = buildResourceStub({ resource: application, models: bot.models })
          application.tree.top = buildResourceStub({ resource: payload, models: bot.models })
        }
        return
      }
      // pairs = pairs.find(pair => pair.parent === parentApp.requestFor)
      // if (!pairs)
      //   return
      // debugger
      // application.parent = parentApp
      let stub = buildResourceStub({ resource: parentApp, models: bot.models })
      application.parent = stub
      application.top = parentApp.top || stub

      await this.findAndInsertTreeNode({
        application,
        parentApp,
        payload
      })

      application.associatedResource = buildResourceStub({
        resource: associatedRes,
        models: bot.models
      })
      await smeVerifierAPI.checkAndUpdateNotification(application)
    },
    async findAndInsertTreeNode({ application, parentApp, payload }) {
      let { top, parent } = application

      let topApp = await bot.getLatestResource(top)
      debugger
      const models = bot.models
      let appStub = buildResourceStub({ resource: application, models })
      appStub.requestFor = application.requestFor
      let payloadStub = buildResourceStub({ resource: payload, models })
      let node
      let nodes
      if (topApp.tree.top && topApp.tree.top.nodes) node = findNode(topApp.tree.top.nodes, parent)
      if (!node) node = topApp.tree
      if (!node.top.nodes) node.top.nodes = {}
      nodes = node.top.nodes

      nodes[application._permalink] = {
        ...appStub,
        top: payloadStub
      }
      topApp.tree = { ...topApp.tree }
      await applications.updateApplication(topApp)
    }
  }
  return { plugin }
}

export const validateConf: ValidatePluginConf = async ({ bot, conf, pluginConf }) => {
  const { models } = bot
  debugger
  if (!pluginConf) throw new Error(`there is no 'pairs' in conf`)
  if (!Array.isArray(pluginConf)) throw new Error(`'pairs' should be an array in conf`)
  if (!pluginConf.length) throw new Error(`'pairs' is empty in conf`)
  pluginConf.forEach(pair => {
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

function findNode(tree, node) {
  for (let p in tree) {
    if (p === 'nodes') {
      let n = findNode(tree[p], node)
      if (n) return n
      continue
    }
    if (tree[p]._permalink === node._permalink) return tree[p]
    if (typeof tree[p] === 'object') {
      let n = findNode(tree[p], node)
      if (n) return n
    }
  }
}
