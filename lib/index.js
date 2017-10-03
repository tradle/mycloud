"use strict";
const debug = require('debug')('tradle:sls');
const ENV = require("./env");
const requireMaybeDefault = (() => {
    const cache = {};
    return (path) => {
        if (!cache[path]) {
            const result = require(path);
            cache[path] = result.__esModule ? result.default : result;
        }
        return cache[path];
    };
})();
const createNewInstance = env => new Tradle(env);
class Tradle {
    constructor(env = ENV) {
        this.new = createNewInstance;
        this.createInstance = createNewInstance;
        this.construct = (Ctor) => {
            return new Ctor(this);
        };
        this.define = (property, path, instantiator) => {
            let instance;
            defineGetter(this, property, () => {
                if (!instance) {
                    if (path) {
                        const subModule = requireMaybeDefault(path);
                        instance = instantiator(subModule);
                    }
                    else {
                        instance = instantiator();
                    }
                    debug('defined', property);
                }
                return instance;
            });
        };
        const { SERVERLESS_PREFIX } = env;
        this.env = env;
        this.prefix = SERVERLESS_PREFIX;
        this.define('blockchain', './blockchain', Blockchain => new Blockchain(this.network));
        this.define('seals', './seals', this.construct);
        this.define('resources', './resources', this.construct);
        this.define('tables', './tables', this.construct);
        this.define('buckets', './buckets', this.construct);
        this.define('db', './db', initialize => initialize(this));
        this.define('s3Utils', './s3-utils', this.construct);
        this.define('lambdaUtils', './lambda-utils', this.construct);
        this.define('iot', './iot-utils', initialize => initialize({
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
    }
    get aws() {
        return requireMaybeDefault('./aws');
    }
    get networks() {
        return requireMaybeDefault('./networks');
    }
    get network() {
        const { BLOCKCHAIN } = this.env;
        return this.networks[BLOCKCHAIN.flavor][BLOCKCHAIN.networkName];
    }
    get models() {
        return requireMaybeDefault('./models');
    }
    get constants() {
        return requireMaybeDefault('./constants');
    }
    get errors() {
        return requireMaybeDefault('./errors');
    }
    get crypto() {
        return requireMaybeDefault('./crypto');
    }
    get utils() {
        return requireMaybeDefault('./utils');
    }
    get stringUtils() {
        return requireMaybeDefault('./string-utils');
    }
    get dbUtils() {
        return requireMaybeDefault('./db-utils');
    }
    get wrap() {
        return requireMaybeDefault('./wrap');
    }
}
Tradle.new = createNewInstance;
Tradle.createInstance = createNewInstance;
function defineGetter(obj, property, get) {
    Object.defineProperty(obj, property, { get });
}
const defaultInstance = new Tradle(ENV);
module.exports = defaultInstance;
//# sourceMappingURL=index.js.map