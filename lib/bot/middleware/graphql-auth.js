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
const engine_1 = require("@tradle/engine");
const validateResource = require("@tradle/validate-resource");
const _1 = require("../../");
const utils_1 = require("../../utils");
const debug = require('debug')('tradle:sls:graphql-auth');
const { TYPE, SIG, MAX_CLOCK_DRIFT } = _1.constants;
exports.createHandler = ({ bot }, { allowGuest, canUserRunQuery }) => {
    const { identities } = bot;
    return (ctx, next) => __awaiter(this, void 0, void 0, function* () {
        const method = ctx.method.toLowerCase();
        if (method === 'options') {
            yield next();
            return;
        }
        if (method !== 'get' && method !== 'post') {
            ctx.status = 403;
            ctx.body = {
                message: `method "${method}" is forbidden`
            };
            return;
        }
        debug('authenticating');
        const sig = ctx.headers['x-tradle-sig'];
        if (!allowGuest && sig == null) {
            ctx.status = 403;
            ctx.body = {
                message: `expected header "x-tradle-sig"`
            };
            debug('expected sig');
            return;
        }
        const queryObj = {
            [TYPE]: 'tradle.GraphQLQuery',
            body: engine_1.utils.stringify(ctx.event)
        };
        if (sig)
            queryObj[SIG] = sig;
        try {
            validateResource({
                models: bot.models,
                model: bot.models['tradle.GraphQLQuery'],
                resource: queryObj
            });
        }
        catch (err) {
            throw new _1.Errors.InvalidInput(`invalid tradle.GraphQLQuery: ${err.message}`);
        }
        checkDrift(queryObj.time);
        let { user } = ctx;
        if (sig && !user) {
            debug('looking up query author');
            yield identities.addAuthorInfo(queryObj);
            ctx.user = user = yield bot.users.get(queryObj._author);
        }
        let allowed = canUserRunQuery({ user, query: queryObj });
        if (utils_1.isPromise(allowed))
            allowed = yield allowed;
        if (!allowed) {
            ctx.status = 403;
            ctx.body = {
                message: 'not allowed'
            };
            return;
        }
        debug('allowing');
        yield next();
    });
};
function checkDrift(time) {
    time = Number(time);
    const drift = time - Date.now();
    const abs = Math.abs(drift);
    if (abs > MAX_CLOCK_DRIFT) {
        const type = drift > 0 ? 'ahead' : 'behind';
        throw new _1.Errors.ClockDrift(`your clock is ${type}`);
    }
}
//# sourceMappingURL=graphql-auth.js.map