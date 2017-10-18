"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("./globals");
const createLogger = require("debug");
const yn = require("yn");
const Networks = require("./networks");
const utils_1 = require("./utils");
const constants_1 = require("./constants");
const returnInfinity = () => Infinity;
class Env {
    constructor(props) {
        this.set = props => {
            Object.assign(this, props);
            this._recalc(props);
        };
        this.logger = (namespace) => {
            let logger = createLogger(`λ:${this.nick}:${namespace}`);
            let currentNick = this.nick;
            return (...args) => {
                if (currentNick !== this.nick) {
                    currentNick = this.nick;
                    logger = createLogger(`λ:${this.nick}:${namespace}`);
                }
                logger(...args);
            };
        };
        this.setDebugNamespace = (nickname) => {
            this.nick = nickname;
            this.debug = createLogger(`λ:${nickname}`);
        };
        this.getRemainingTime = () => {
            return Infinity;
        };
        this.setFromLambdaEvent = (event, context) => {
            this.IS_WARM_UP = event.source === constants_1.WARMUP_SOURCE_NAME;
            if (this.TESTING) {
                this.debug('setting TEST resource map');
                this.set(require('../test/service-map'));
            }
            const { invokedFunctionArn, getRemainingTimeInMillis } = context;
            if (invokedFunctionArn) {
                const { accountId } = utils_1.parseArn(invokedFunctionArn);
                this.set({ accountId });
            }
            this.set({
                event,
                context,
                getRemainingTime: getRemainingTimeInMillis
            });
        };
        this._recalc = (props) => {
            if ('SERVERLESS_STAGE' in props) {
                this.DEV = !this.SERVERLESS_STAGE.startsWith('prod');
            }
            if ('NO_TIME_TRAVEL' in props) {
                this.NO_TIME_TRAVEL = yn(props.NO_TIME_TRAVEL);
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
        this.FUNCTION_NAME = AWS_LAMBDA_FUNCTION_NAME || '[unknown]';
        const shortName = AWS_LAMBDA_FUNCTION_NAME
            ? AWS_LAMBDA_FUNCTION_NAME.slice(SERVERLESS_PREFIX.length)
            : '[unknown]';
        this.setDebugNamespace(shortName);
        this.set(props);
        if (this.TESTING) {
            this.debug('setting TEST resource map');
            require('../test/env').install(this);
        }
    }
}
exports.default = Env;
//# sourceMappingURL=env.js.map