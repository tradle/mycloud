// @ts-ignore
import Promise from 'bluebird'
import _ from 'lodash'
import { Lambda } from '../types'

const notNull = val => !!val

export const onMessage = (lambda: Lambda, { onSuccess, onError }) => {
  const { logger, tasks, messages, userSim } = lambda.bot
  return async (ctx, next) => {
    const { clientId, event } = ctx
    logger.debug(`preprocessing ${event.messages.length} messages`)
    const results = await Promise.mapSeries(event.messages, async (message, i) => {
      try {
        messages.validateInbound(message)
        message = await userSim.onSentMessage({ message, clientId })
      } catch (error) {
        return { message, error }
      }

      return { message }
    })

    const [failures, successes] = _.partition(results, 'error')
    const handleErrors = Promise.mapSeries(failures, failure => onError({ ...failure, clientId }))
    event.messages = successes.map(s => s.message)
    const count = event.messages.length
    if (!count) return

    logger.debug(`preprocessed ${count} messages`)
    await next()
    await Promise.mapSeries(successes, success => onSuccess({ ...success, clientId }))
    logger.debug(`postprocessed ${count} messages`)
  }
}
