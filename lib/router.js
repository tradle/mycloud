const debug = require('debug')('tradle:sls:router')
const express = require('express')
const bodyParser = require('body-parser')
const compression = require('compression')
const cors = require('cors')
const helmet = require('helmet')
const coexpress = require('co-express')
const constants = require('./constants')
const Errors = require('./errors')

module.exports = function createRouter ({ user, env, utils, init }) {
  const { HTTP_METHODS=constants.HTTP_METHODS } = env
  const { timestamp } = utils
  const app = express()
  app.use(compression())
  app.use(cors())
  app.use(helmet())
  app.use(bodyParser.json())
  app.use(bodyParser.urlencoded({ extended: true }))
  app.use(function (req, res, next) {
    req._tradleStartTimestamp = timestamp()
    debug(`[START] ${getReqUrl(req)}`, req._tradleStartTimestamp)
    debug(`setting Access-Control-Allow-Methods: ${HTTP_METHODS}`)
    res.header('Access-Control-Allow-Methods', HTTP_METHODS)
    next()
  })

  app.post('/inbox', coexpress(function* (req, res) {
    // debug('[START] /auth', timestamp())
    const { messages } = req.body
    debug(`received ${messages.length} messages in inbox`)
    for (const message of messages) {
      yield user.onSentMessage({ message })
    }

    res.end()
  }))

  // TODO: scrap this in favor of /inbox,
  // adjust @tradle/aws-client accordingly
  app.post('/onmessage', coexpress(function* (req, res) {
    const event = req.body
    const { message } = event.body
    // the user sent us a message
    const result = yield user.onSentMessage({ message })
    // debug('preceived')
    res.json(result)
  }))

  app.post('/log', coexpress(function* (req, res) {
    res.json({
      event: req.event,
      body: req.body,
      context: req.context
    })
  }))

  app.get('/info', coexpress(function* (req, res) {
    debug('[START] /info', timestamp())
    yield init.ensureInitialized()
    const result = yield user.onGetInfo()
    res.json(result)
  }))

  app.post('/preauth', coexpress(function* (req, res) {
    yield init.ensureInitialized()

    console.log(JSON.stringify(req.body))
    // debug('[START]', now)
    const { clientId, identity } = req.body
    const { accountId } = req.event.requestContext
    console.log({ clientId, accountId })
    const session = yield user.onPreAuth({ accountId, clientId, identity })
    res.json(session)
  }))

  app.post('/auth', coexpress(function* (req, res) {
    // debug('[START] /auth', Date.now())
    const event = req.body
    // TODO: use @tradle/validate-resource
    const result = yield user.onSentChallengeResponse(req.body)
    res.json(result)
  }))

  app.use(function (err, req, res, next) {
    console.error(err.stack, err)
    if (Errors.isCustomError(err)) {
      res.status(400).json(Errors.export(err))
    } else {
      res.status(500).json({
        message: `something went wrong, we're looking into it`
      })
    }
  })

  app.use(function (req, res, next) {
    const start = req._tradleStartTimestamp
    const end = timestamp()
    debug(`[END] ${getReqUrl(req)}, ${end}, time: ${(end - start)/1000}ms`)
    next()
  })

  // const handleRequest = (event, context) => {
  //   awsServerlessExpress.proxy(server, event, context)
  // }

  // if (process.env.NODE_ENV === 'test') {
  //   const port = 20120

  //   app.listen(port)
  //   console.log(`listening on http://localhost:${port}`)
  // }

  return app
}

function getReqUrl (req) {
  return req.protocol + '://' + req.get('host') + req.originalUrl
}
