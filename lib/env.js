"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("./globals");
const yn = require("yn");
const debug = require("debug");
const randomName = require("random-name");
const Networks = require("./networks");
const utils_1 = require("./utils");
const crypto_1 = require("./crypto");
const constants_1 = require("./constants");
const logger_1 = require("./logger");
const package_json_1 = require("../package.json");
class Env {
    constructor(props) {
        this.set = props => {
            Object.assign(this, props);
            this._recalc(props);
        };
        this.get = () => {
            return JSON.stringify(this);
        };
        this.sublogger = (namespace) => {
            return this.logger.logger({ namespace });
        };
        this.getRemainingTime = () => {
            return Infinity;
        };
        this.setFromLambdaEvent = ({ event, context, source }) => {
            if (this.containerId) {
                this.logger.info('I am a used container!');
                this.isVirgin = false;
            }
            else {
                this.logger.info('I am a fresh container!');
                this.isVirgin = true;
                this.containerId = `${randomName.first()} ${randomName.middle()} ${randomName.last()} ${crypto_1.randomString(6)}`;
            }
            if (source === 'lambda' && event.requestContext) {
                this.setRequestContext(event.requestContext);
            }
            context.callbackWaitsForEmptyEventLoop = false;
            this.IS_WARM_UP = event.source === constants_1.WARMUP_SOURCE_NAME;
            const { invokedFunctionArn, getRemainingTimeInMillis } = context;
            let props = {
                event,
                context,
                getRemainingTime: getRemainingTimeInMillis
            };
            if (invokedFunctionArn) {
                const { accountId } = utils_1.parseArn(invokedFunctionArn);
                props.accountId = accountId;
            }
            this.set(props);
            const requestCtx = {
                'correlation-id': context.awsRequestId,
                'container-id': this.containerId
            };
            if (source) {
                requestCtx['correlation-source'] = source;
            }
            if (this._X_AMZN_TRACE_ID) {
                requestCtx['trace-id'] = this._X_AMZN_TRACE_ID;
            }
            if (this.IS_OFFLINE) {
                requestCtx['function'] = this.FUNCTION_NAME;
            }
            this.setRequestContext(requestCtx);
        };
        this._recalc = (props) => {
            if ('SERVERLESS_STAGE' in props) {
                this.DEV = !this.SERVERLESS_STAGE.startsWith('prod');
            }
            if ('NO_TIME_TRAVEL' in props) {
                this.NO_TIME_TRAVEL = yn(props.NO_TIME_TRAVEL);
            }
            if ('LAMBDA_BIRTH_DATE' in props) {
                this.LAMBDA_BIRTH_DATE = Number(props.LAMBDA_BIRTH_DATE);
            }
            this.REGION = this.AWS_REGION;
            if ('IS_LAMBDA_ENVIRONMENT' in props) {
                this.IS_LAMBDA_ENVIRONMENT = yn(props.IS_LAMBDA_ENVIRONMENT);
            }
            else if (typeof this.IS_LAMBDA_ENVIRONMENT !== 'boolean') {
                this.IS_LAMBDA_ENVIRONMENT = !this.TESTING;
            }
            if ('BLOCKCHAIN' in props) {
                const [flavor, networkName] = props.BLOCKCHAIN.split(':');
                this.BLOCKCHAIN = Networks[flavor][networkName];
            }
        };
        const { SERVERLESS_PREFIX, SERVERLESS_STAGE, NODE_ENV, IS_LOCAL, IS_OFFLINE, AWS_REGION, AWS_LAMBDA_FUNCTION_NAME, NO_TIME_TRAVEL, BLOCKCHAIN } = props;
        this.TESTING = NODE_ENV === 'test' || yn(IS_LOCAL) || yn(IS_OFFLINE);
        this.FUNCTION_NAME = AWS_LAMBDA_FUNCTION_NAME
            ? AWS_LAMBDA_FUNCTION_NAME.slice(SERVERLESS_PREFIX.length)
            : '[unknown]';
        const namespace = this.TESTING ? package_json_1.name : '';
        this.logger = new logger_1.default({
            namespace,
            context: {},
            level: 'DEBUG_LEVEL' in props ? Number(props.DEBUG_LEVEL) : logger_1.Level.DEBUG,
            writer: this.TESTING ? { log: debug(namespace) } : global.console,
            outputFormat: this.TESTING ? 'text' : 'json'
        });
        this.debug = this.logger.debug;
        this.debug('TESTING', this.TESTING);
        this.set(props);
    }
    get containerAge() {
        return this.LAMBDA_BIRTH_DATE ? Date.now() - this.LAMBDA_BIRTH_DATE : null;
    }
    setRequestContext(ctx) {
        const prefixed = {};
        for (let key in ctx) {
            if (key.startsWith('x-')) {
                prefixed[key] = ctx[key];
            }
            else {
                prefixed['x-' + key] = ctx[key];
            }
        }
        this.requestCtx = prefixed;
        this.logger.setContext(this.requestCtx);
    }
    getRequestContext() {
        return Object.assign({}, this.requestCtx);
    }
}
exports.default = Env;
//# sourceMappingURL=env.js.map