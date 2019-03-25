import _ from 'lodash'
import { IPluginOpts, CreatePlugin, ValidatePluginConf } from '../types'
import { Webhooks, IWebhooksConf, IWebhookEvent } from '../webhooks'
import { randomString } from '../../crypto'
import { topics as EventTopics } from '../../events'

const DEFAULT_BACKOFF_OPTS = {
  maxAttempts: 3
}

export interface IWebhooksPluginOpts extends IPluginOpts {
  conf: IWebhooksConf
}

export const name = 'webhooks'
export const createPlugin: CreatePlugin<Webhooks> = (
  { bot },
  { conf, logger }: IWebhooksPluginOpts
) => {
  const webhooks = new Webhooks({ bot, logger, conf })
  const getFireOpts = () => ({
    backoff: {
      ...DEFAULT_BACKOFF_OPTS,
      maxTime: Math.max(Math.min(bot.env.getRemainingTime() - 2000, 60000), 5000)
    }
  })

  const prepareForDelivery = object => {
    object = _.cloneDeep(object)
    bot.objects.presignEmbeddedMediaLinks({ object, stripEmbedPrefix: true })
    return object
  }

  const messageEventHandler = async event => {
    bot.tasks.add({
      name: `webhook:msg`,
      promiser: () => plugin.deliverMessageEvent(event.message)
    })
  }

  bot.hookSimple(EventTopics.message.outbound.async, messageEventHandler)
  bot.hookSimple(EventTopics.message.inbound.async, messageEventHandler)
  bot.hookSimple(EventTopics.resource.save.async, async event => {
    bot.tasks.add({
      name: 'webhook:save',
      promiser: () => plugin.deliverSaveEvent(event.value)
    })
  })

  const fireAll = async (events: IWebhookEvent | IWebhookEvent[], expand) => {
    events = [].concat(events)
    if (expand) events = Webhooks.expandEvents(events)

    logger.debug('firing events', {
      events: events.map(({ topic }) => topic)
    })

    const opts = getFireOpts()
    return await Promise.all(events.map(event => webhooks.fire(event, opts)))
  }

  const deliverSaveEvent = async resource => {
    await fireAll(
      {
        id: randomString(10),
        time: Date.now(),
        // it's actually async, but there's no need to force webhook subscriptions
        // to specify async:save:...
        topic: EventTopics.resource.save.sync,
        data: prepareForDelivery(resource)
      },
      true
    )
  }

  const deliverMessageEvent = async message => {
    await fireAll(
      {
        id: randomString(10),
        time: Date.now(),
        // it's actually async, but there's no need to force webhook subscriptions
        // to specify async:save:...
        topic: message._inbound
          ? EventTopics.message.inbound.sync
          : EventTopics.message.outbound.sync,
        data: prepareForDelivery(message)
      },
      true
    )
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

export const validateConf: ValidatePluginConf = async ({ pluginConf }) => {
  // const webhooks = new Webhooks({
  //   bot: conf.bot,
  //   conf: pluginConf,
  //   logger: conf.bot.logger
  // })

  Webhooks.validateSubscriptions(pluginConf.subscriptions)
}
