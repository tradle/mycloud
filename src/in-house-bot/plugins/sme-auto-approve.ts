import _ from 'lodash'
import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils
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
import { getEnumValueId } from '../../utils'

const CP = 'tradle.legal.LegalEntityControllingPerson'
const PRODUCT_REQUEST = 'tradle.ProductRequest'
const APPLICATION = 'tradle.Application'
const APPLICATION_SUBMITTED = 'tradle.ApplicationSubmitted'
const NOTIFICATION_STATUS = 'tradle.NotificationStatus'
const NOTIFICATION = 'tradle.Notification'
const STATUS = 'tradle.Status'

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
export class TreeBuilder {
  private bot: Bot
  private applications: Applications
  private logger: Logger
  constructor({ bot, applications, logger }) {
    this.bot = bot
    this.applications = applications
    this.logger = logger
  }

  public async updateCpNode(req) {
    let node
    let { application, payload } = req
    let { tree } = application
    if (tree.top.nodes) node = this.findNode({ tree: tree.top.nodes, node: payload })
    else tree.top.nodes = {}

    if (!node) {
      tree.top.nodes[payload._permalink] = {}
      node = tree.top.nodes[payload._permalink]
    }

    const { models } = this.bot
    let payloadStub = buildResourceStub({ resource: payload, models })

    let prefill = await this.fillCpNode(req)
    _.extend(payloadStub, prefill)
    _.extend(node, payloadStub)

    application.tree = { ...application.tree }
  }
  async updateWithNotifications({ application, tree }) {
    let notifications = await Promise.all(
      application.notifications.map(n => this.bot.getResource(n))
    )
    let top
    if (tree) top = application
    else {
      top = await this.bot.getLatestResource(application.top)
      tree = top.tree
    }
    notifications.forEach((n: any) => {
      let form = n.form
      let node = this.findNode({ tree: tree.top.nodes, node: form })
      node.lastNotified = n.dateLastNotified
      node.timesNotified = n.timesNotified
      node.notifiedStatus = getEnumValueId({
        model: this.bot.models[NOTIFICATION_STATUS],
        value: n.status
      })
    })
    top.tree = { ...top.tree }
    await this.applications.updateApplication(top)
  }
  public async findAndInsertTreeNode({ req, isInit }) {
    let { application, payload } = req
    let { top, parent, associatedResource } = application

    let topApp = await this.bot.getLatestResource(top)
    // debugger
    let node
    let nodes
    let associatedNode
    if (isInit)
      associatedNode = this.findNode({
        tree: topApp.tree.top.nodes,
        node: associatedResource,
        doDelete: isInit
      })

    if (topApp.tree.top && topApp.tree.top.nodes)
      node = this.findNode({ tree: topApp.tree.top.nodes, node: parent })

    if (!node) node = topApp.tree
    if (!node.top.nodes) node.top.nodes = {}
    nodes = node.top.nodes

    const { models } = this.bot
    let appStub
    if (nodes[application._permalink]) {
      let stub = buildResourceStub({ resource: application, models })
      appStub = nodes[application._permalink]
    } else {
      appStub = buildResourceStub({ resource: application, models })
      let payloadStub = buildResourceStub({ resource: payload, models })
      appStub.top = payloadStub
    }
    let prefill = await this.fillNode({ req })
    _.extend(appStub, prefill)
    if (associatedNode) {
      let { timesNotified, notifiedStatus, dateLastNotified } = associatedNode
      _.extend(appStub, { timesNotified, notifiedStatus, dateLastNotified })
      appStub = sanitize(appStub).sanitized
    } else if (payload && payload[TYPE] === CP) {
      if (!appStub.top.nodes) appStub.top.nodes = {}
      let payloadStub = buildResourceStub({ resource: payload, models })
      if (!appStub.top.nodes[payload._permalink])
        appStub.top.nodes[payload._permalink] = payloadStub
      await this.updateCpNode({ application: topApp, payload, latestChecks: req.latestChecks })
    }

    nodes[application._permalink] = {
      ...appStub
    }
    topApp.tree = { ...topApp.tree }
    await this.applications.updateApplication(topApp)
  }
  public async fillNode({ req }) {
    let { application } = req
    let ok = (req.latestChecks && req.latestChecks.length) || application.checksCount

    if (application.numberOfChecksFailed) ok -= application.numberOfChecksFailed
    if (application.numberOfCheckOverrides) {
      let checksOverride = application.checksOverride
      if (!checksOverride)
        checksOverride = await this.bot.getResource(application, { backlinks: ['checksOverride'] })
      checksOverride = Promise.all(
        application.checkOverrides.map(co => this.bot.objects.get(co._link))
      )
      let failed = 0
      let pass = 0
      checksOverride.forEach(co => {
        let status = getEnumValueId({ model: this.bot.models[co[TYPE]], value: co.status })
        if (status === 'pass') pass++
        else failed++
      })
      ok = ok + pass - failed
    }
    let hours = 3600 * 60 * 24
    let {
      requestFor,
      maxFormTypesCount,
      submittedFormTypesCount,
      numberOfChecksFailed,
      numberOfCheckOverrides,
      checksCount,
      reviewer,
      lastMsgToClientTime,
      formsCount,
      dateStarted,
      dateCompleted,
      status,
      assignedToTeam,
      associatedResource,
      parent,
      score,
      scoreType
    } = application
    let node = {}
    let progress = Math.round((submittedFormTypesCount / maxFormTypesCount) * 100)
    progress = Math.min(progress, 100)
    _.extend(node, {
      new: true,
      requestFor,
      numberOfChecksFailed,
      submittedFormTypesCount,
      maxFormTypesCount,
      progress,
      numberOfCheckOverrides,
      associatedResource: associatedResource._permalink,
      parent: parent._permalink,
      ok,
      RM: reviewer && reviewer._displayName,
      lastMsgToClientTime,
      dateStarted,
      dateCompleted,
      // stalled: lastMsgToClientTime && Math.round((Date.now() - lastMsgToClientTime) / hours),
      // waiting: (status === 'completed' && Math.round((Date.now() - dateCompleted) / hours)) || 0,
      // delayed: dateCompleted && Math.round((dateCompleted - dateStarted) / hours),
      formsCount,
      status,
      assignedToTeam,
      score: Math.round(score),
      scoreType
    })
    return sanitize(node).sanitized
  }
  async fillCpNode(req) {
    let { application, payload, latestChecks } = req
    let ok, fail
    if (latestChecks && latestChecks.length) {
      let checks = latestChecks.filter(check => check.form._permalink === payload._permalink)
      if (checks.length) {
        ok = checks.filter(
          check =>
            getEnumValueId({ model: this.bot.models[STATUS], value: check.status }) === 'pass'
        ).length
        fail = checks.filter(
          check =>
            getEnumValueId({ model: this.bot.models[STATUS], value: check.status }) === 'fail'
        ).length
      }
    }
    let numberOfCheckOverrides
    if (application.numberOfCheckOverrides) {
      let checksOverride = application.checksOverride
      if (!checksOverride)
        checksOverride = await this.bot.getResource(application, { backlinks: ['checksOverride'] })
      checksOverride = Promise.all(
        application.checkOverrides.map(co => this.bot.objects.get(co._link))
      )

      let failed = 0
      let pass = 0
      checksOverride.forEach(co => {
        if (!co.form._permalink === payload._permalink) return
        let status = getEnumValueId({ model: this.bot.models[co[TYPE]], value: co.status })
        if (status === 'pass') pass++
        else failed++
      })
      ok = ok + pass - failed
      numberOfCheckOverrides = pass + failed
    }
    let node = {
      new: true,
      numberOfChecksFailed: fail,
      numberOfCheckOverrides,
      parent: application._permalink,
      ok,
      percentageOfOwnership: payload.percentageOfOwnership
    }
    return sanitize(node).sanitized
  }
  findNode({ tree, node, doDelete }: { tree: any; node: any; doDelete?: boolean }) {
    for (let p in tree) {
      if (p === 'nodes') {
        let n = this.findNode({ tree: tree[p], node, doDelete })
        if (n) return n
        continue
      }
      if (
        tree[p]._permalink === node._permalink ||
        tree[p].associatedResource === node._permalink
      ) {
        let foundNode = tree[p]
        if (doDelete) delete tree[p]
        return foundNode
      }
      if (typeof tree[p] === 'object') {
        let n = this.findNode({ tree: tree[p], node, doDelete })
        if (n) return n
      }
    }
  }
}
export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const smeVerifierAPI = new SmeVerifier({ bot, conf, applications, logger })
  const treeBuilderAPI = new TreeBuilder({ bot, applications, logger })
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
        await treeBuilderAPI.findAndInsertTreeNode({
          req: { application },
          isInit: false
        })

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
      await treeBuilderAPI.findAndInsertTreeNode({
        req,
        isInit: false
      })

      if (notification)
        await bot.versionAndSave({
          ...notification,
          // dateLastModified: Date.now(),
          status: enumValue({ model: bot.models[NOTIFICATION_STATUS], value: 'completed' })
        })
    },
    async onResourceCreated(value) {
      // useRealSES(bot)
      if (value[TYPE] !== NOTIFICATION) return
      let application = await bot.getResource(value.application, { backlinks: ['notifications'] })
      let topApp
      let { top } = application
      if (top) topApp = await bot.getLatestResource(top)
      else topApp = application
      await treeBuilderAPI.updateWithNotifications({ application, tree: topApp.tree })
      await applications.updateApplication(topApp)
    },

    async onResourceChanged({ old, value }) {
      // useRealSES(bot)
      if (value[TYPE] !== NOTIFICATION) return
      if (
        old.notified === value.notified ||
        getEnumValueId({ model: bot.models[NOTIFICATION_STATUS], value: value.status }) ===
          'completed'
      )
        return
      let application = await bot.getResource(value.application, { backlinks: ['notifications'] })
      let topApp
      let { top } = application
      if (top) topApp = await bot.getLatestResource(top)
      else topApp = application
      await treeBuilderAPI.updateWithNotifications({ application, tree: topApp.tree })
      await applications.updateApplication(topApp)
    },
    async onmessage(req: IPBReq) {
      // debugger
      const { application, payload } = req
      if (!application || !application.forms || !conf.length || application.draft) return

      // if (application.parent) {
      //   await smeVerifierAPI.checkAndUpdateNotification(application)
      //   return
      // }
      const { requestFor } = application

      let pairs = conf.filter(pair => requestFor === pair.child)

      if (!pairs.length) return
      logger.debug('Child application was submitted')
      let { parentApp, associatedRes } = await getAssociateResources({ application, bot })
      const { models } = bot

      if (application.notifications) {
        await treeBuilderAPI.updateWithNotifications({ application, tree: application.tree })
      }

      if (!parentApp) {
        if (!application.tree) {
          application.tree = buildResourceStub({ resource: application, models })
          application.tree.top = buildResourceStub({ resource: payload, models })
          return
        }
        if (payload[TYPE] === CP) {
          if (!application.tree.top.nodes) application.tree.top.nodes = {}
          await treeBuilderAPI.updateCpNode(req)
        }
        return
      }
      // pairs = pairs.find(pair => pair.parent === parentApp.requestFor)
      // if (!pairs)
      //   return
      // debugger
      // application.parent = parentApp
      let isInit
      if (!application.parent) {
        let stub = buildResourceStub({ resource: parentApp, models })
        application.parent = stub
        isInit = true
        application.top = parentApp.top || stub
      }
      application.associatedResource = buildResourceStub({
        resource: associatedRes,
        models
      })
      await treeBuilderAPI.findAndInsertTreeNode({
        req,
        isInit
      })

      await smeVerifierAPI.checkAndUpdateNotification(application)
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
