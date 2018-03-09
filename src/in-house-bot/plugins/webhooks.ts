import _ from 'lodash'
import { TYPE } from '@tradle/constants'
import { Conf, IPluginOpts, IPluginExports, IPluginLifecycleMethods } from '../types'
import { Webhooks, IWebhooksConf } from '../webhooks'
import { randomString } from '../../crypto'

const DEFAULT_CONF = require('./form-prefills.json')
const DEFAULT_BACKOFF_OPTS = {
  maxAttempts: 3
}

export interface IWebhooksPluginOpts extends IPluginOpts {
  conf: IWebhooksConf
}

export const name = 'webhooks'
export const createPlugin = ({ bot, conf, logger }: IWebhooksPluginOpts):IPluginExports => {
  const webhooks = new Webhooks({ bot, conf, logger })
  const getFireOpts = () => ({
    backoff: {
      ...DEFAULT_BACKOFF_OPTS,
      maxTime: Math.max(Math.min(bot.env.getRemainingTime() - 2000, 60000), 5000)
    }
  })

  const prepareForDelivery = object => {
    object = _.cloneDeep(object)
    bot.objects.presignEmbeddedMediaLinks({
      object,
      stripEmbedPrefix: true
    })

    return object
  }

  bot.hook('message', async (ctx, next) => {
    let { type, message } = ctx.event

    message = prepareForDelivery(message)
    const payload = message.object
    const messageEvents = [
      'msg:i',
      `msg:i:${type}`
    ].map(topic => ({
      id: randomString(10),
      time: Date.now(),
      topic,
      data: message
    })).concat()

    const payloadEvents = [
      `save:${type}`
    ].map(topic => ({
      id: randomString(10),
      time: Date.now(),
      topic,
      data: payload
    }))

    const events = messageEvents.concat(payloadEvents)
    const opts = getFireOpts()
    await Promise.all(events.map(event => webhooks.fire(event, opts)))
    await next()
  })

  bot.hook('save', async (ctx, next) => {
    let { method, resource } = ctx.event
    const subTopics = [
      'save',
      `save:${resource[TYPE]}`
    ]

    resource = prepareForDelivery(resource)
    const opts = getFireOpts()
    await Promise.all(subTopics.map(topic => webhooks.fire({
      id: randomString(10),
      time: Date.now(),
      topic,
      data: resource
    }, opts)))

    await next()
  })

  const plugin:IPluginLifecycleMethods = {}
  return {
    api: webhooks,
    plugin
  }
}

export const validateConf = ({ conf, pluginConf }: {
  conf: Conf,
  pluginConf: IWebhooksConf
}) => {
  // const webhooks = new Webhooks({
  //   bot: conf.bot,
  //   conf: pluginConf,
  //   logger: conf.bot.logger
  // })

  Webhooks.validateSubscriptions(pluginConf.subscriptions)
}
