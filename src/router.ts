import express = require('express')
import compression = require('compression')
import coexpress = require('co-express')
import constants = require('./constants')
import Errors = require('./errors')

module.exports = function createRouter (tradle) {
  const { user, friends, env, utils, init } = tradle
  const logger = env.sublogger('router')
  const {
    HTTP_METHODS=constants.HTTP_METHODS,
    TESTING,
    _X_AMZN_TRACE_ID,
    FUNCTION_NAME
  } = env

  const { timestamp } = utils
  const app = express()
  app.use(function (req, res, next) {
    if (env.DISABLED) {
      logger.warn('returning 500 as this function is disabled')
      return res.status(500).end()
    }

    next()
  })

  if (!TESTING) {
    app.use(compression())
  }

  app.use(function (req, res, next) {
    req._tradleStartTimestamp = timestamp()
    const path = getReqPath(req)
    // env.setDebugNamespace(path)
    logger.debug(`[START] ${req.method} ${path}`, req._tradleStartTimestamp)
    if (_X_AMZN_TRACE_ID) {
      logger.info('_X_AMZN_TRACE_ID', _X_AMZN_TRACE_ID)
    }

    logger.debug(`setting Access-Control-Allow-Methods: ${HTTP_METHODS}`)
    res.header('Access-Control-Allow-Methods', HTTP_METHODS)
    if (env.IS_WARM_UP) {
      utils.onWarmUp({
        env,
        event: req.event,
        context: req.context,
        callback: function () {
          logger.info('all warmed up')
          return res.end()
        }
      })

      return
    }

    next()
  })

  if (FUNCTION_NAME === 'inbox') {
    require('./routes/inbox')({ tradle, router: app })
  } else if (FUNCTION_NAME === 'preauth') {
    require('./routes/preauth')({ tradle, router: app })
  } else if (FUNCTION_NAME === 'auth') {
    require('./routes/auth')({ tradle, router: app })
  } else if (FUNCTION_NAME === 'onmessage_http') {
    // TODO: scrap this in favor of /inbox,
    // adjust @tradle/aws-client accordingly
    require('./routes/onmessage_http')({ tradle, router: app })
  } else if (FUNCTION_NAME === 'addfriend_dev' && TESTING) {
    require('./routes/addfriend_dev')({ tradle, router: app })
  }

  // app.post('/log', coexpress(function* (req, res) {
  //   res.json({
  //     event: req.event,
  //     body: req.body,
  //     context: req.context
  //   })
  // }))


  app.use(defaultErrorHandler)
  app.use(function (req, res, next) {
    const start = req._tradleStartTimestamp
    const end = timestamp()
    logger.debug(`[END] ${getReqPath(req)}, ${end}, time: ${(end - start)/1000}ms`)
    if (_X_AMZN_TRACE_ID) {
      logger.info('_X_AMZN_TRACE_ID', _X_AMZN_TRACE_ID)
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
      res.status(500).json(TESTING ? JSON.stringify(err) : {
        message: `something went wrong, we're looking into it`
      })
    }
  }
}

function getReqPath (req) {
  return req.originalUrl
}
