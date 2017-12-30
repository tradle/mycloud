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
const task_manager_1 = require("./task-manager");
const require_default_1 = require("./require-default");
const buckets_1 = require("./buckets");
const model_store_1 = require("./model-store");
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
        this.warmUpCaches = () => __awaiter(this, void 0, void 0, function* () {
            yield Promise.all([
                this.provider.getMyPrivateIdentity(),
                this.provider.getMyPublicIdentity()
            ]);
        });
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
        this.define('buckets', './buckets', () => buckets_1.getBuckets(this));
        this.define('db', './db', initialize => initialize(this));
        this.define('s3Utils', './s3-utils', initialize => initialize({
            s3: this.aws.s3,
            logger: this.logger.sub('s3-utils')
        }));
        this.define('contentAddressedStore', './content-addressed-store', ctor => {
            return new ctor({
                bucket: this.buckets.ContentAddressed,
                aws: this.aws
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
                conf: this.kv.sub(':push'),
                provider: this.provider
            });
        });
        this.tasks = new task_manager_1.TaskManager({
            logger: this.logger.sub('async-tasks')
        });
        this.modelStore = model_store_1.createModelStore(this);
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