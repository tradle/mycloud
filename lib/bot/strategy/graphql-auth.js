"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const debug = require('debug')('tradle:sls:graphql-auth');
const coexpress = require("co-express");
const pick = require("object.pick");
const engine_1 = require("@tradle/engine");
const validateResource = require("@tradle/validate-resource");
const constants_1 = require("../../constants");
const Errors = require("../../errors");
function createGraphQLAuth({ tradle, bot, employeeManager }) {
    const { identities, objects } = tradle;
    return coexpress(function* (req, res, next) {
        const method = req.method.toLowerCase();
        if (method === 'options') {
            next();
            return;
        }
        if (method !== 'get' && method !== 'post') {
            res.status(403).json({
                message: `method "${method}" is forbidden`
            });
            return;
        }
        debug('authenticating');
        const sig = req.headers['x-tradle-sig'];
        if (sig == null) {
            res.status(403).json({
                message: `expected header "x-tradle-sig"`
            });
            debug('expected sig');
            return;
        }
        const props = Object.keys(req).filter(key => req[key] != null);
        const body = pick(req, props);
        const queryObj = {
            [constants_1.TYPE]: 'tradle.GraphQLQuery',
            [constants_1.SIG]: sig,
            body: engine_1.utils.stringify(req.body)
        };
        try {
            validateResource({
                models: bot.models,
                model: bot.models['tradle.GraphQLQuery'],
                resource: queryObj
            });
        }
        catch (err) {
            throw new Errors.InvalidInput(`invalid tradle.GraphQLQuery: ${err.message}`);
        }
        checkDrift(queryObj.time);
        debug('looking up query author');
        yield identities.addAuthorInfo(queryObj);
        const user = yield bot.users.get(queryObj._author);
        if (!employeeManager.isEmployee(user)) {
            debug('rejecting non-employee');
            res.status(403).json({
                message: 'employees only'
            });
            return;
        }
        debug('allowing');
        next();
    });
}
exports.createGraphQLAuth = createGraphQLAuth;
function checkDrift(time) {
    time = Number(time);
    const drift = time - Date.now();
    const abs = Math.abs(drift);
    if (abs > constants_1.MAX_CLOCK_DRIFT) {
        const type = drift > 0 ? 'ahead' : 'behind';
        throw new Errors.ClockDrift(`your clock is ${type}`);
    }
}
//# sourceMappingURL=graphql-auth.js.map