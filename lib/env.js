"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("./globals");
const yn = require("yn");
const debug = require("debug");
const constants_1 = require("./constants");
const logger_1 = require("./logger");
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
            return this.lambda ? this.lambda.timeLeft : 0;
        };
        this.setLambda = (lambda) => {
            this.lambda = lambda;
            this.setRequestContext(lambda.reqCtx);
            const { event, context } = lambda.execCtx;
            this.IS_WARM_UP = event.source === constants_1.WARMUP_SOURCE_NAME;
            this.set({ accountId: lambda.accountId });
        };
        this._recalc = (props) => {
            if ('SERVERLESS_STAGE' in props) {
                this.DEV = !this.SERVERLESS_STAGE.startsWith('prod');
            }
            if ('NO_TIME_TRAVEL' in props) {
                this.NO_TIME_TRAVEL = yn(props.NO_TIME_TRAVEL);
            }
            if ('INVOKE_BOT_LAMBDAS_DIRECTLY' in props) {
                this.INVOKE_BOT_LAMBDAS_DIRECTLY = yn(props.INVOKE_BOT_LAMBDAS_DIRECTLY);
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
                this.BLOCKCHAIN = { flavor, networkName };
            }
        };
        const { SERVERLESS_PREFIX, SERVERLESS_STAGE, NODE_ENV, IS_LOCAL, IS_OFFLINE, AWS_REGION, AWS_LAMBDA_FUNCTION_NAME, AWS_LAMBDA_FUNCTION_MEMORY_SIZE, NO_TIME_TRAVEL, BLOCKCHAIN } = props;
        this.TESTING = NODE_ENV === 'test' || yn(IS_LOCAL) || yn(IS_OFFLINE);
        this.FUNCTION_NAME = AWS_LAMBDA_FUNCTION_NAME
            ? AWS_LAMBDA_FUNCTION_NAME.slice(SERVERLESS_PREFIX.length)
            : '[unknown]';
        this.MEMORY_SIZE = isNaN(AWS_LAMBDA_FUNCTION_MEMORY_SIZE)
            ? 512
            : Number(AWS_LAMBDA_FUNCTION_MEMORY_SIZE);
        const namespace = `λ:${this.FUNCTION_NAME}`;
        this.logger = new logger_1.default({
            namespace: this.TESTING ? '' : namespace,
            writer: this.TESTING ? { log: debug(`λ:${this.FUNCTION_NAME}`) } : global.console,
            outputFormat: props.DEBUG_FORMAT || 'text',
            context: {},
            level: 'DEBUG_LEVEL' in props ? Number(props.DEBUG_LEVEL) : logger_1.Level.DEBUG,
        });
        this.debug = this.logger.debug;
        this.set(props);
    }
    setRequestContext(ctx) {
        this.reqCtx = ctx;
        this.logger.setContext(this.reqCtx);
    }
    getRequestContext() {
        return Object.assign({}, this.reqCtx);
    }
}
exports.default = Env;
//# sourceMappingURL=env.js.map