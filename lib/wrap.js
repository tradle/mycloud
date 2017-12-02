"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("./utils");
const logger_1 = require("./logger");
const RESOLVED = Promise.resolve();
exports = module.exports = wrap;
exports.wrap = wrap;
function wrap(fn, opts) {
    const { env, source, type } = opts;
    if (env.DISABLED) {
        return (event, context, callback) => callback(new Error('function is disabled'));
    }
    const { debug } = env;
    const wrapper = (...args) => __awaiter(this, void 0, void 0, function* () {
        require.track = true;
        const callback = logify(args.pop());
        let [event, context] = args;
        const eventInfo = {
            event,
            context,
            source
        };
        env.setFromLambdaEvent(eventInfo);
        if (eventInfo.source === 'lambda' && event.requestContext && event.payload) {
            event = args[0] = event.payload;
        }
        if (env.IS_WARM_UP) {
            return utils_1.onWarmUp({
                env,
                event,
                context,
                callback
            });
        }
        let monitor;
        if (env.logger.level >= logger_1.Level.DEBUG) {
            const now = Date.now();
            monitor = setInterval(() => {
                const time = Date.now() - now;
                const params = {
                    time,
                    event: time > 20000 && event
                };
                debug('event processing time', params);
            }, 5000).unref();
        }
        let ret;
        try {
            ret = utils_1.applyFunction(fn, this, args);
            if (isPromise(ret))
                ret = yield ret;
            yield env.finishAsyncTasks();
        }
        catch (err) {
            clearInterval(monitor);
            return callback(err);
        }
        finally {
            require.track = false;
        }
        clearInterval(monitor);
        debug(`finished wrapped task: ${fn.name}`);
        callback(null, ret);
    });
    const logify = cb => {
        return function (err, result) {
            if (err)
                debug('wrapped task failed', err);
            cb(err, result);
        };
    };
    return wrapper;
}
function isPromise(obj) {
    return obj && typeof obj.then === 'function';
}
process.on('unhandledRejection', (reason, p) => {
    console.error('Unhandled Rejection at:', p, 'reason:', reason);
});
//# sourceMappingURL=wrap.js.map