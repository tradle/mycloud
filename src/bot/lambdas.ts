const { wrap } = require('../')

module.exports = function createLambdas (bot) {
  const handlers = {}
  const { process, debug, env } = bot
  for (let event in process) {
    let method = `on${event}`
    debug(`attached bot lambda handler: ${method}`)
    let { source, type, handler } = process[event]
    if (type === 'wrapped') {
      handlers[method] = handler
    } else {
      handlers[method] = wrap(handler, { type, source, env })
    }
  }

  return handlers
}
