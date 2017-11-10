const express = require('express');
const bodyParser = require('body-parser');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const coexpress = require('co-express');
const constants = require('./constants');
const Errors = require('./errors');
module.exports = function createRouter({ user, friends, env, utils, init }) {
    const logger = env.sublogger('router');
    const { HTTP_METHODS = constants.HTTP_METHODS, TESTING } = env;
    const { timestamp } = utils;
    const app = express();
    app.use(function (req, res, next) {
        if (env.DISABLED) {
            logger.warn('returning 500 as this function is disabled');
            return res.status(500).end();
        }
        next();
    });
    if (!TESTING) {
        app.use(compression());
    }
    const { _X_AMZN_TRACE_ID } = env;
    app.use(cors());
    app.use(helmet());
    app.use(bodyParser.json({ limit: '10mb' }));
    app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
    app.use(function (req, res, next) {
        req._tradleStartTimestamp = timestamp();
        const path = getReqPath(req);
        logger.debug(`[START] ${req.method} ${path}`, req._tradleStartTimestamp);
        if (_X_AMZN_TRACE_ID) {
            logger.info('_X_AMZN_TRACE_ID', _X_AMZN_TRACE_ID);
        }
        logger.debug(`setting Access-Control-Allow-Methods: ${HTTP_METHODS}`);
        res.header('Access-Control-Allow-Methods', HTTP_METHODS);
        if (env.IS_WARM_UP) {
            utils.onWarmUp({
                env,
                event: req.event,
                context: req.context,
                callback: function () {
                    logger.info('all warmed up');
                    return res.end();
                }
            });
            return;
        }
        next();
    });
    const inboxHandler = coexpress(function* (req, res) {
        const { messages } = req.body;
        logger.debug(`receiving ${messages.length} messages in inbox`);
        for (const message of messages) {
            try {
                yield user.onSentMessage({ message });
            }
            catch (err) {
                if (err instanceof Errors.Duplicate) {
                    logger.debug('received duplicate');
                    continue;
                }
                throw err;
            }
        }
        logger.debug(`received ${messages.length} messages in inbox`);
        res.json({});
    });
    app.put('/inbox', inboxHandler);
    app.post('/inbox', inboxHandler);
    const messageHandler = coexpress(function* (req, res) {
        const event = req.body;
        const { message } = event;
        const result = yield user.onSentMessage({ message });
        res.json(result);
    });
    app.post('/message', messageHandler);
    app.put('/message', messageHandler);
    app.get('/info', coexpress(function* (req, res) {
        logger.debug('[START] /info', timestamp());
        yield init.ensureInitialized();
        const result = yield user.onGetInfo();
        res.json(result);
    }));
    app.post('/preauth', coexpress(function* (req, res) {
        yield init.ensureInitialized();
        const { clientId, identity } = req.body;
        const { accountId } = req.event.requestContext;
        const session = yield user.onPreAuth({ accountId, clientId, identity });
        res.json(session);
    }));
    app.post('/auth', coexpress(function* (req, res) {
        const event = req.body;
        const result = yield user.onSentChallengeResponse(req.body);
        res.json(result);
    }));
    if (TESTING) {
        app.post('/addfriend', coexpress(function* (req, res) {
            const { handler } = require('./lambda/add-friend');
            const result = yield utils.promisify(handler)(req.body, env.context);
            if (result && typeof result === 'object') {
                res.json(result);
            }
            else {
                res.end();
            }
        }));
    }
    app.use(defaultErrorHandler);
    app.use(function (req, res, next) {
        const start = req._tradleStartTimestamp;
        const end = timestamp();
        logger.debug(`[END] ${getReqPath(req)}, ${end}, time: ${(end - start) / 1000}ms`);
        if (_X_AMZN_TRACE_ID) {
            logger.info('_X_AMZN_TRACE_ID', _X_AMZN_TRACE_ID);
        }
        next();
    });
    app.defaultErrorHandler = defaultErrorHandler;
    return app;
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