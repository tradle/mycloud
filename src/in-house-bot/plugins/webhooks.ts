import _ from 'lodash'
import { TYPE } from '@tradle/constants'
import { Conf, IPluginOpts, IPluginExports, IPluginLifecycleMethods } from '../types'
import { Webhooks, IWebhooksConf, IWebhookEvent } from '../webhooks'
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
    const { message } = ctx.event
    await plugin.deliverMessageEvent(message)
    await next()
  })

  bot.objects.hook('put', async (ctx, next) => {
    const { object } = ctx.event
    await plugin.deliverSaveEvent(object)
    await next()
  })

  const fireAll = async (events:IWebhookEvent[]) => {
    logger.debug('firing events', {
      events: events.map(({ topic }) => topic)
    })

    const opts = getFireOpts()
    return await Promise.all(events.map(event => webhooks.fire(event, opts)))
  }

  const deliverSaveEvent = async (resource) => {
    resource = prepareForDelivery(resource)
    const events = Webhooks.expandEvents({
      id: randomString(10),
      time: Date.now(),
      topic: 'save',
      data: resource
    })

    await fireAll(events)
  }

  const deliverMessageEvent = async (message) => {
    message = prepareForDelivery(message)

    const time = Date.now()
    const payload = message.object
    const messageEvents = Webhooks.expandEvents({
      id: randomString(10),
      time,
      topic: 'msg:i',
      data: message
    })

    const payloadEvents = Webhooks.expandEvents({
      id: randomString(10),
      time,
      topic: 'save',
      data: payload
    })

    const events = messageEvents.concat(payloadEvents)
    await fireAll(events)
  }

  const plugin = {
    deliverMessageEvent,
    deliverSaveEvent
  }

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
