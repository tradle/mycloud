"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("./globals");
const createLogger = require("debug");
const yn = require("yn");
const Networks = require("./networks");
const utils_1 = require("./utils");
class Env {
    constructor(props) {
        this.set = props => Object.assign(this, props);
        this.logger = (namespace) => {
            let logger = createLogger(`λ:${this.nick}:${namespace}`);
            let currentNick = this.nick;
            return (...args) => {
                if (currentNick !== this.nick) {
                    currentNick = this.nick;
                    logger = createLogger(`λ:${this.nick}:${namespace}`);
                }
                return logger(...args);
            };
        };
        this.setDebugNamespace = (nickname) => {
            this.nick = nickname;
            this.debug = createLogger(`λ:${nickname}`);
        };
        this.setFromLambdaEvent = (event, context) => {
            this.IS_WARM_UP = event.source === 'serverless-plugin-warmup';
            if (this.TESTING) {
                this.debug('setting TEST resource map');
                this.set(require('../test/service-map'));
            }
            const { invokedFunctionArn } = context;
            if (invokedFunctionArn) {
                const { accountId } = utils_1.parseArn(invokedFunctionArn);
                this.set({ accountId });
            }
        };
        this.set(props);
        const { SERVERLESS_PREFIX, SERVERLESS_STAGE = '', NODE_ENV, IS_LOCAL, IS_OFFLINE, AWS_REGION, AWS_LAMBDA_FUNCTION_NAME, NO_TIME_TRAVEL, BLOCKCHAIN = 'ethereum:rinkeby' } = props;
        this.TESTING = NODE_ENV === 'test' || yn(IS_LOCAL) || yn(IS_OFFLINE);
        this.FUNCTION_NAME = AWS_LAMBDA_FUNCTION_NAME || '[unknown]';
        const shortName = AWS_LAMBDA_FUNCTION_NAME
            ? AWS_LAMBDA_FUNCTION_NAME.slice(SERVERLESS_PREFIX.length)
            : '[unknown]';
        this.setDebugNamespace(shortName);
        if (this.TESTING) {
            this.debug('setting TEST resource map');
            require('../test/env').install(this);
        }
        const [flavor, networkName] = BLOCKCHAIN.split(':');
        this.BLOCKCHAIN = Networks[flavor][networkName];
        this.DEV = !SERVERLESS_STAGE.startsWith('prod');
        this.NO_TIME_TRAVEL = yn(NO_TIME_TRAVEL);
        this.REGION = this.AWS_REGION;
        this.IS_LAMBDA_ENVIRONMENT = !!AWS_REGION;
    }
}
exports.default = Env;
//# sourceMappingURL=env.js.map