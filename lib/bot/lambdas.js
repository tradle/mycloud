const { wrap, debug } = require('../')

module.exports = function createLambdas (bot) {
  const handlers = {}
  const { process } = bot
  for (let event in process) {
    let method = `on${event}`
    debug(`attached bot lambda handler: ${method}`)
    let { type, handler } = process[event]
    if (type === 'wrapped') {
      handlers[method] = handler
    } else {
      handlers[method] = wrap(handler, { type })
    }
  }

  return handlers
}
