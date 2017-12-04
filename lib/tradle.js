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
const env_1 = require("./env");
const require_default_1 = require("./require-default");
const utils_1 = require("./utils");
let instanceCount = 0;
class Tradle {
    constructor(env = new env_1.default(process.env)) {
        this.createHttpHandler = () => {
            const { createHandler } = require('./http-request-handler');
            return createHandler(this);
        };
        this.initAllSubModules = () => {
            for (let p in this) {
                this[p];
            }
        };
        this.warmUpCaches = () => {
            this.provider.getMyPrivateIdentity();
            this.provider.getMyPublicIdentity();
        };
        this.construct = (Ctor) => {
            return new Ctor(this);
        };
        this.define = (property, path, instantiator) => {
            let instance;
            defineGetter(this, property, () => {
                if (!instance) {
                    if (path) {
                        const subModule = require_default_1.requireDefault(path);
                        instance = instantiator(subModule);
                    }
                    else {
                        instance = instantiator();
                    }
                    this.logger.silly(`defined ${property}`);
                }
                return instance;
            });
        };
        if (!(env instanceof env_1.default)) {
            env = new env_1.default(env);
        }
        const { SERVERLESS_PREFIX } = env;
        this.env = env;
        this.prefix = SERVERLESS_PREFIX;
        this.define('blockchain', './blockchain', this.construct);
        this.define('seals', './seals', this.construct);
        this.define('serviceMap', './service-map', this.construct);
        this.define('tables', './tables', this.construct);
        this.define('buckets', './buckets', this.construct);
        this.define('db', './db', initialize => initialize(this));
        this.define('s3Utils', './s3-utils', initialize => initialize({
            s3: this.aws.s3,
            logger: this.logger.sub('s3-utils')
        }));
        this.define('contentAddressedStorage', './content-addressed-storage', ctor => {
            return new ctor({
                bucket: this.buckets.ContentAddressed,
                aws: this.aws
            });
        });
        this.define('conf', './key-value-table', ctor => {
            return new ctor({
                table: this.tables.Conf
            });
        });
        this.define('kv', './key-value-table', ctor => {
            return new ctor({
                table: this.tables.KV
            });
        });
        this.define('lambdaUtils', './lambda-utils', this.construct);
        this.define('iot', './iot-utils', initialize => initialize(this));
        this.define('identities', './identities', this.construct);
        this.define('friends', './friends', this.construct);
        this.define('messages', './messages', this.construct);
        this.define('events', './events', initialize => initialize(this));
        this.define('provider', './provider', this.construct);
        this.define('auth', './auth', this.construct);
        this.define('objects', './objects', this.construct);
        this.define('secrets', './secrets', initialize => initialize({
            bucket: this.buckets.Secrets
        }));
        this.define('init', './init', this.construct);
        this.define('discovery', './discovery', this.construct);
        this.define('user', './user', this.construct);
        this.define('delivery', './delivery', this.construct);
        this.define('router', './router', this.construct);
        this.define('aws', './aws', initialize => initialize(this));
        this.define('dbUtils', './db-utils', initialize => initialize({
            aws: this.aws,
            logger: this.logger.sub('db-utils')
        }));
        this.define('pushNotifications', './push', ctor => {
            if (!this.env.PUSH_SERVER_URL) {
                this.logger.warn('missing PUSH_SERVER_URL, push notifications not available');
                return;
            }
            return new ctor({
                logger: this.env.sublogger('push'),
                serverUrl: this.env.PUSH_SERVER_URL,
                conf: this.conf,
                provider: this.provider
            });
        });
    }
    get apiBaseUrl() {
        return this.serviceMap.RestApi.ApiGateway;
    }
    get version() {
        return require('./version');
    }
    get networks() {
        return require_default_1.requireDefault('./networks');
    }
    get network() {
        const { BLOCKCHAIN } = this.env;
        return this.networks[BLOCKCHAIN.flavor][BLOCKCHAIN.networkName];
    }
    get models() {
        return require_default_1.requireDefault('./models');
    }
    get constants() {
        return require_default_1.requireDefault('./constants');
    }
    get errors() {
        return require_default_1.requireDefault('./errors');
    }
    get crypto() {
        return require_default_1.requireDefault('./crypto');
    }
    get utils() {
        return require_default_1.requireDefault('./utils');
    }
    get stringUtils() {
        return require_default_1.requireDefault('./string-utils');
    }
    get wrap() {
        const wrap = require_default_1.requireDefault('./wrap');
        return (fn, opts = {}) => {
            if (!opts.env)
                opts.env = this.env;
            return wrap((...args) => __awaiter(this, void 0, void 0, function* () {
                this.warmUpCaches();
                return utils_1.applyFunction(fn, this, args);
            }), opts);
        };
    }
    get logger() {
        return this.env.logger;
    }
    get debug() {
        return this.env.debug;
    }
}
exports.default = Tradle;
function defineGetter(obj, property, get) {
    Object.defineProperty(obj, property, { get });
}
//# sourceMappingURL=tradle.js.map