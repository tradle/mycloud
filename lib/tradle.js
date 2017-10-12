"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const env_1 = require("./env");
const require_default_1 = require("./require-default");
const createNewInstance = env => new Tradle(env);
class Tradle {
    constructor(env = new env_1.default(process.env)) {
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
                    this.debug('defined', property);
                }
                return instance;
            });
        };
        const { SERVERLESS_PREFIX } = env;
        this.env = env;
        this.prefix = SERVERLESS_PREFIX;
        this.define('blockchain', './blockchain', this.construct);
        this.define('seals', './seals', this.construct);
        this.define('resources', './resources', this.construct);
        this.define('tables', './tables', this.construct);
        this.define('buckets', './buckets', this.construct);
        this.define('db', './db', initialize => initialize(this));
        this.define('s3Utils', './s3-utils', this.construct);
        this.define('lambdaUtils', './lambda-utils', this.construct);
        this.define('iot', './iot-utils', initialize => initialize({
            aws: this.aws,
            prefix: env.IOT_TOPIC_PREFIX
        }));
        this.define('identities', './identities', this.construct);
        this.define('friends', './friends', this.construct);
        this.define('messages', './messages', this.construct);
        this.define('events', './events', this.construct);
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
        this.define('dbUtils', './db-utils', initialize => initialize(this));
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
        return require_default_1.requireDefault('./wrap');
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