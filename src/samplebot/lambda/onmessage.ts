
import { createTradle } from '../../'
import { createBot } from '../bot'

const tradle = createTradle()
const promiseBot = createBot(tradle)
const handler = tradle.wrap(function* (...args) {
  const { lambdas } = await promiseBot
  await lambdas.onmessage(...args)
})

export {
  handler,
  promiseBot // for testing
}
