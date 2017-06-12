const debug = require('debug')('tradle:sls:webhooks')
const superagent = require('superagent')
const { co, executeSuperagentRequest } = require('./utils')
const { WebhooksTable } = require('./tables')
const { WEBHOOKS } = require('./constants')
const {
  initialDelay,
  maxDelay,
  maxRetries
} = WEBHOOKS

const register = co(function* ({ event, url }) {
  return WebhooksTable.put({
    Key: { event, url },
    Item: {
      event,
      url,
      // how many times did this webhook not respond
      timesFailed: 0,
      // how long has this webhook not been responding
      // dateFirstFailed: 0
    }
  })
})

const unregister = co(function* ({ event, url }) {
  return WebhooksTable.del({
    Key: { event, url }
  })
})

const getEventSubscriptions = co(function* (event) {
  return WebhooksTable.find({
    KeyCondition: 'event = :event',
    ExpressionAttributeValues: {
      ':event': event
    }
  })
})

const recordResult = co(function* ({ subscription, failed }) {
  const { event, url } = subscription
  if (failed) {
    if (!subscription.timesFailed) {
      subscription.dateFirstFailed = Date.now()
    }

    subscription.timesFailed++
  } else {
    delete subscription.dateFirstFailed
  }

  yield WebhooksTable.put({
    Key: { event, url },
    Item: subscription
  })
})

const call = co(function* ({ event }) {
  const subs = yield getEventSubscriptions(event)
  const promises = subs.map(callOne)
  return Promise.all(promises)
})

const callOne = co(function* (subscription) {
  const { event, url } = subscription
  const req = superagent.post(url).send({ event })
  let failed = false
  try {
    yield executeSuperagentRequest(req)
  } catch (err) {
    failed = true
  }

  yield recordResult({ subscription, failed })
})

const onWebhookStreamEvent = co(function* (subscription) {
  let { event, url, timesFailed } = subscription
  if (!subscription.timesFailed) {
    // schedule next
    return
  }

  if (++timesFailed >= maxRetries) {
    debug(`giving up calling "${url}" for "${event}" event after ${timesFailed}`)
    return unregister(subscription)
  }

  const delay = Math.min(maxDelay, initialDelay * Math.pow(2, timesFailed))
  yield scheduleWebhookCall({ subscription, delay })
})

module.exports = {
  register,
  unregister,
  getEventSubscriptions
}
