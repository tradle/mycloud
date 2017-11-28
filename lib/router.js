"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require("express");
const compression = require("compression");
const constants = require("./constants");
const Errors = require("./errors");
const utils = require("./utils");
module.exports = function createRouter(tradle) {
    const { env } = tradle;
    const logger = env.sublogger('router');
    const { HTTP_METHODS = constants.HTTP_METHODS, TESTING, _X_AMZN_TRACE_ID, FUNCTION_NAME } = env;
    const { timestamp } = utils;
    const router = express();
    router.use(function (req, res, next) {
        if (env.DISABLED) {
            logger.warn('returning 500 as this function is disabled');
            return res.status(500).end();
        }
        next();
    });
    if (!TESTING) {
        router.use(compression());
    }
    router.use(function (req, res, next) {
        req._tradleStartTimestamp = timestamp();
        const path = getReqPath(req);
        logger.debug(`[START] ${req.method} ${path}`, req._tradleStartTimestamp);
        if (_X_AMZN_TRACE_ID) {
            logger.info('_X_AMZN_TRACE_ID', _X_AMZN_TRACE_ID);
        }
        logger.debug(`setting Access-Control-Allow-Methods: ${HTTP_METHODS}`);
        res.header('Access-Control-Allow-Methods', HTTP_METHODS);
        if (!env.IS_WARM_UP)
            return next();
        utils.onWarmUp({
            env,
            event: req.event,
            context: req.context,
            callback: function (err, data) {
                logger.info('all warmed up');
                if (err) {
                    res.status(500).json({
                        message: err.message,
                        stack: err.stack
                    });
                }
                else {
                    res.json(data || {});
                }
            }
        });
    });
    if (FUNCTION_NAME === 'inbox') {
        require('./routes/inbox')({ tradle, router });
    }
    else if (FUNCTION_NAME === 'preauth') {
        require('./routes/preauth')({ tradle, router });
    }
    else if (FUNCTION_NAME === 'auth') {
        require('./routes/auth')({ tradle, router });
    }
    else if (FUNCTION_NAME === 'onmessage_http') {
        require('./routes/onmessage_http')({ tradle, router });
    }
    else if (FUNCTION_NAME === 'addfriend_dev' && TESTING) {
        require('./routes/addfriend_dev')({ tradle, router });
    }
    router.use(defaultErrorHandler);
    router.defaultErrorHandler = defaultErrorHandler;
    return router;
    function defaultErrorHandler(err, req, res, next) {
        console.error('sending HTTP error', err.stack, err);
        if (Errors.isCustomError(err)) {
            res.status(400).json(Errors.export(err));
        }
        else {
            res.status(500).json(TESTING ? JSON.stringify(err) : {
                message: `something went wrong, we're looking into it`
            });
        }
    }
};
function getReqPath(req) {
    return req.originalUrl;
}
//# sourceMappingURL=router.js.map