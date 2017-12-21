"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const engine_1 = require("@tradle/engine");
const crypto = require("./crypto");
const utils = require("./utils");
const Errors = require("./errors");
const constants_1 = require("./constants");
const debug = require('debug')('tradle:sls:init');
const { getLink, addLinks, getIdentitySpecs, getChainKey } = crypto;
const { omitVirtual, setVirtual, omit, deepEqual, bindAll, promisify, co } = utils;
const { exportKeys } = require('./crypto');
module.exports = Initializer;
function Initializer({ env, networks, network, secrets, provider, buckets, objects, identities, seals, models, db }) {
    bindAll(this);
    this.env = env;
    this.secrets = secrets;
    this.networks = networks;
    this.network = network;
    this.provider = provider;
    this.buckets = buckets;
    this.objects = objects;
    this.identities = identities;
    this.seals = seals;
    this.models = models;
    this.db = db;
}
const proto = Initializer.prototype;
proto.ensureInitialized = co(function* (opts) {
    const initialized = yield this.isInitialized();
    if (!initialized) {
        yield this.init(opts);
    }
});
proto.init = co(function* (opts = {}) {
    const result = yield this.createProvider();
    yield this.write(Object.assign({}, result, opts));
    return result;
});
proto.isInitialized = (function () {
    let initialized;
    return co(function* () {
        if (!initialized) {
            initialized = yield this.secrets.exists(constants_1.IDENTITY_KEYS_KEY);
        }
        return initialized;
    });
}());
proto.createProvider = co(function* () {
    const priv = yield createIdentity(getIdentitySpecs({
        networks: this.networks
    }));
    const pub = priv.identity;
    debug('created identity', JSON.stringify(pub));
    return {
        pub,
        priv
    };
});
proto.write = co(function* (opts) {
    const { priv, pub, force } = opts;
    if (!force) {
        try {
            const existing = yield this.secrets.get(constants_1.IDENTITY_KEYS_KEY);
            if (!deepEqual(existing, priv)) {
                throw new Errors.Exists('refusing to overwrite identity keys. ' +
                    'If you\'re absolutely sure you want to do this, use the "force" flag');
            }
        }
        catch (err) {
            Errors.ignore(err, Errors.NotFound);
        }
    }
    const { PublicConf } = this.buckets;
    yield [
        this.secrets.put(constants_1.IDENTITY_KEYS_KEY, priv),
        this.objects.put(pub),
        PublicConf.putJSON(constants_1.PUBLIC_CONF_BUCKET.identity, pub)
    ];
    const { network } = this;
    const chainKey = getChainKey(priv.keys, {
        type: network.flavor,
        networkName: network.networkName
    });
    yield Promise.all([
        this.identities.addContact(pub),
        this.seals.create({
            key: chainKey,
            link: pub._link
        })
    ]);
});
proto.clear = co(function* () {
    let priv;
    try {
        priv = yield this.secrets.get(constants_1.IDENTITY_KEYS_KEY);
    }
    catch (err) {
        Errors.ignore(err, Errors.NotFound);
    }
    const link = priv && getLink(priv.identity);
    debug(`terminating provider ${link}`);
    const { PublicConf } = this.buckets;
    yield [
        link ? this.objects.del(link) : Promise.resolve(),
        this.secrets.del(constants_1.IDENTITY_KEYS_KEY),
        PublicConf.del(constants_1.PUBLIC_CONF_BUCKET.identity),
        PublicConf.del(constants_1.PUBLIC_CONF_BUCKET.info)
    ];
    debug(`terminated provider ${link}`);
});
const _createIdentity = promisify(engine_1.utils.newIdentity);
const createIdentity = co(function* (opts) {
    const { link, identity, keys } = yield _createIdentity(opts);
    setVirtual({
        _link: link,
        _permalink: link
    });
    return {
        identity,
        keys: exportKeys(keys)
    };
});
//# sourceMappingURL=init.js.map