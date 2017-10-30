const express = require('express')
const bodyParser = require('body-parser')
const compression = require('compression')
const cors = require('cors')
const helmet = require('helmet')
const coexpress = require('co-express')
const constants = require('./constants')
const Errors = require('./errors')

module.exports = function createRouter ({ user, friends, env, utils, init }) {
  const debug = env.logger('router')
  const { HTTP_METHODS=constants.HTTP_METHODS } = env
  const { timestamp } = utils
  const app = express()
  app.use(function (req, res, next) {
    if (env.DISABLED) {
      debug('returning 500 as this function is disabled')
      return res.status(500).end()
    }

    next()
  })

  if (!env.TESTING) {
    app.use(compression())
  }

  const { _X_AMZN_TRACE_ID } = env

  app.use(cors())
  app.use(helmet())
  app.use(bodyParser.json({ limit: '10mb' }))
  app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }))
  app.use(function (req, res, next) {
    req._tradleStartTimestamp = timestamp()
    const path = getReqPath(req)
    env.setDebugNamespace(path)
    debug(`[START] ${req.method} ${path}`, req._tradleStartTimestamp)
    if (_X_AMZN_TRACE_ID) {
      debug('_X_AMZN_TRACE_ID', _X_AMZN_TRACE_ID)
    }

    debug(`setting Access-Control-Allow-Methods: ${HTTP_METHODS}`)
    res.header('Access-Control-Allow-Methods', HTTP_METHODS)
    if (env.IS_WARM_UP) {
      utils.onWarmUp({
        env,
        event: req.event,
        context: req.context,
        callback: function () {
          debug('all warmed up')
          return res.end()
        }
      })

      return
    }

    next()
  })

  const inboxHandler = coexpress(function* (req, res) {
    // debug('[START] /auth', timestamp())
    const { messages } = req.body
    debug(`receiving ${messages.length} messages in inbox`)
    for (const message of messages) {
      try {
        yield user.onSentMessage({ message })
      } catch (err) {
        if (err instanceof Errors.Duplicate) {
          debug('received duplicate')
          continue
        }

        throw err
      }
    }

    debug(`received ${messages.length} messages in inbox`)
    // i don't think API Gateway likes non-json responses
    // it lets them through but Content-Type ends up as application/json
    // and clients fail on trying to parse an empty string as json
    res.json({})
  })

  app.put('/inbox', inboxHandler)
  app.post('/inbox', inboxHandler)

  // TODO: scrap this in favor of /inbox,
  // adjust @tradle/aws-client accordingly

  const messageHandler = coexpress(function* (req, res) {
    const event = req.body
    const { message } = event
    // the user sent us a message
    const result = yield user.onSentMessage({ message })
    res.json(result)
    // debug('preceived')
  })

  app.post('/message', messageHandler)
  app.put('/message', messageHandler)

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

  if (env.TESTING) {
    app.post('/addfriend', coexpress(function* (req, res) {
      const { handler } = require('./lambda/add-friend')
      const result = yield utils.promisify(handler)(req.body, env.context)
      if (result && typeof result === 'object') {
        res.json(result)
      } else {
        res.end()
      }
    }))
  }

  app.use(defaultErrorHandler)

  app.use(function (req, res, next) {
    const start = req._tradleStartTimestamp
    const end = timestamp()
    debug(`[END] ${getReqPath(req)}, ${end}, time: ${(end - start)/1000}ms`)
    if (_X_AMZN_TRACE_ID) {
      debug('_X_AMZN_TRACE_ID', _X_AMZN_TRACE_ID)
    }

    next()
  })

  app.defaultErrorHandler = defaultErrorHandler
  return app

  function defaultErrorHandler (err, req, res, next) {
    console.error('sending HTTP error', err.stack, err)
    if (Errors.isCustomError(err)) {
      res.status(400).json(Errors.export(err))
    } else {
      res.status(500).json(env.TESTING ? JSON.stringify(err) : {
        message: `something went wrong, we're looking into it`
      })
    }
  }
}

function getReqPath (req) {
  return req.originalUrl
}
