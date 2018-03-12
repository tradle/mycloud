import _ from 'lodash'
import { TYPE } from '@tradle/constants'
import { Conf, IPluginOpts, IPluginExports, IPluginLifecycleMethods } from '../types'
import { Webhooks, IWebhooksConf, IWebhookEvent } from '../webhooks'
import { randomString } from '../../crypto'
import { topics as EventTopics } from '../../events'

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

  bot.hook('save', async (ctx, next) => {
    await plugin.deliverSaveEvent(ctx.event.object)
    await next()
  })

  const fireAll = async (events:IWebhookEvent|IWebhookEvent[], expand) => {
    events = [].concat(events)
    if (expand) events = Webhooks.expandEvents(events)

    logger.debug('firing events', {
      events: events.map(({ topic }) => topic)
    })

    const opts = getFireOpts()
    return await Promise.all(events.map(event => webhooks.fire(event, opts)))
  }

  const deliverSaveEvent = async (resource) => {
    await fireAll({
      id: randomString(10),
      time: Date.now(),
      topic: 'save',
      data: prepareForDelivery(resource)
    }, true)
  }

  const deliverMessageEvent = async (message) => {
    await fireAll({
      id: randomString(10),
      time: Date.now(),
      topic: EventTopics.message.inbound,
      data: prepareForDelivery(message)
    }, true)
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
