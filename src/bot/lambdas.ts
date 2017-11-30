module.exports = function createLambdas (bot) {
  const handlers = {}
  const { process, debug, env, wrap } = bot
  const fnName = env.FUNCTION_NAME.toLowerCase()
  for (let event in process) {
    // if (!fnName.includes(event.toLowerCase())) continue

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
