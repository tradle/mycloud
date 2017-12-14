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
const debug = require('debug')('tradle:sls:graphql-auth');
const pick = require("object.pick");
const engine_1 = require("@tradle/engine");
const validateResource = require("@tradle/validate-resource");
const _1 = require("../../");
const { TYPE, SIG, MAX_CLOCK_DRIFT } = _1.constants;
function createGraphQLAuth({ bot, employeeManager }) {
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
        if (sig == null) {
            ctx.status = 403;
            ctx.body = {
                message: `expected header "x-tradle-sig"`
            };
            debug('expected sig');
            return;
        }
        const req = ctx.request;
        const props = Object.keys(req).filter(key => req[key] != null);
        const body = pick(req, props);
        const queryObj = {
            [TYPE]: 'tradle.GraphQLQuery',
            [SIG]: sig,
            body: engine_1.utils.stringify(body)
        };
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
        debug('looking up query author');
        yield identities.addAuthorInfo(queryObj);
        const user = yield bot.users.get(queryObj._author);
        if (!employeeManager.isEmployee(user)) {
            debug('rejecting non-employee');
            ctx.status = 403;
            ctx.body = {
                message: 'employees only'
            };
            return;
        }
        debug('allowing');
        yield next();
    });
}
exports.createGraphQLAuth = createGraphQLAuth;
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