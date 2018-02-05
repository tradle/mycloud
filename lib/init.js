"use strict";
const _ = require("lodash");
const crypto = require("./crypto");
const utils_1 = require("./utils");
const Errors = require("./errors");
const constants_1 = require("./constants");
const { IDENTITY } = constants_1.TYPES;
const debug = require('debug')('tradle:sls:init');
const { getLink, addLinks, getIdentitySpecs, getChainKey, genIdentity } = crypto;
const { exportKeys } = require('./crypto');
function Initializer({ env, networks, network, secrets, provider, buckets, objects, identities, seals, models, db }) {
    utils_1.bindAll(this);
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
proto.ensureInitialized = utils_1.co(function* (opts) {
    const initialized = yield this.isInitialized();
    if (!initialized) {
        yield this.init(opts);
    }
});
proto.init = utils_1.co(function* (opts = {}) {
    const [result] = yield Promise.all([
        this.initIdentity(opts),
    ]);
    return result;
});
proto.initIdentity = utils_1.co(function* (opts) {
    const result = yield this.genIdentity();
    yield this.write(Object.assign({}, result, opts));
    return result;
});
proto.isInitialized = (function () {
    let initialized;
    return utils_1.co(function* () {
        if (!initialized) {
            initialized = yield this.secrets.exists(constants_1.IDENTITY_KEYS_KEY);
        }
        return initialized;
    });
}());
proto.enableBucketEncryption = utils_1.co(function* () {
    yield this.buckets.Secrets.enableEncryption();
});
proto.genIdentity = utils_1.co(function* () {
    const priv = yield genIdentity(getIdentitySpecs({
        networks: this.networks
    }));
    const pub = priv.identity;
    utils_1.ensureTimestamped(pub);
    this.objects.addMetadata(pub);
    utils_1.setVirtual(pub, { _author: pub._permalink });
    debug('created identity', JSON.stringify(pub));
    return {
        pub,
        priv
    };
});
proto.write = utils_1.co(function* (opts) {
    const { priv, pub, force } = opts;
    if (!force) {
        try {
            const existing = yield this.secrets.get(constants_1.IDENTITY_KEYS_KEY);
            if (!_.isEqual(existing, priv)) {
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
        PublicConf.putJSON(constants_1.PUBLIC_CONF_BUCKET.identity, pub),
        this.db.put(pub)
    ];
    const { network } = this;
    const chainKey = getChainKey(priv.keys, {
        type: network.flavor,
        networkName: network.networkName
    });
    yield Promise.all([
        this.identities.addContact(pub),
        this.seals.create({
            type: IDENTITY,
            counterparty: null,
            key: chainKey,
            link: pub._link
        })
    ]);
});
proto.clear = utils_1.co(function* () {
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
        PublicConf.del(constants_1.PUBLIC_CONF_BUCKET.identity)
    ];
    debug(`terminated provider ${link}`);
});
module.exports = Initializer;
//# sourceMappingURL=init.js.map