const wrap = require('../wrap')

module.exports = function createLambdas (bot) {
  const handlers = {}
  const { process } = bot
  for (let method in process) {
    let { type, handler } = process[method]
    if (type === 'wrapper') {
      handlers[method] = handler
    } else {
      handlers[method] = wrap(handler, { type })
    }
  }

  return handlers
}
