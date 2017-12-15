"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const engine_1 = require("@tradle/engine");
const constants_1 = require("./constants");
const { identity } = engine_1.types;
const link = val => typeof val === 'string' && val.length === 64;
exports.link = link;
exports.permalink = link;
exports.privateKey = engine_1.typeforce.compile({
    pub: engine_1.typeforce.String,
    priv: engine_1.typeforce.String
});
exports.author = engine_1.typeforce.compile({
    identity,
    keys: engine_1.typeforce.arrayOf(exports.privateKey)
});
exports.identity = identity;
exports.hasType = function hasType(obj) {
    if (!obj[constants_1.TYPE]) {
        throw new Error(`expected string ${constants_1.TYPE}`);
    }
    return true;
};
exports.hasTimestamp = function hasTimestamp(obj) {
    if (typeof obj._time !== 'number') {
        throw new Error(`expected timestamp "_time"`);
    }
    return true;
};
exports.signedObject = function signedObject(obj) {
    engine_1.typeforce(engine_1.types.signedObject, obj);
    engine_1.typeforce(exports.hasType, obj);
    return true;
};
exports.unsignedObject = function unsignedObject(obj) {
    engine_1.typeforce(engine_1.types.rawObject, obj);
    engine_1.typeforce(exports.hasType, obj);
    return true;
};
exports.message = engine_1.typeforce.compile({
    [constants_1.SEQ]: engine_1.typeforce.Number,
    [constants_1.SIG]: engine_1.typeforce.String,
    object: engine_1.types.signedObject,
    [constants_1.PREV_TO_RECIPIENT]: engine_1.typeforce.maybe(engine_1.typeforce.String),
    recipientPubKey: engine_1.types.ecPubKey,
    time: engine_1.typeforce.Number,
    _author: engine_1.typeforce.maybe(link),
    _recipient: engine_1.typeforce.maybe(link),
    _link: engine_1.typeforce.maybe(link),
    _permalink: engine_1.typeforce.maybe(link),
    _inbound: engine_1.typeforce.maybe(engine_1.typeforce.Boolean),
});
exports.messageStub = engine_1.typeforce.compile({
    time: engine_1.typeforce.Number,
    link: link
});
exports.position = engine_1.typeforce.compile({
    time: engine_1.typeforce.maybe(exports.messageStub),
    received: engine_1.typeforce.maybe(exports.messageStub)
});
exports.blockchain = engine_1.typeforce.compile({
    flavor: engine_1.typeforce.String,
    networkName: engine_1.typeforce.String,
    pubKeyToAddress: engine_1.typeforce.Function,
    seal: engine_1.typeforce.Function
});
exports.address = {
    bitcoin: function (val) {
        const bitcoin = require('@tradle/bitcoinjs-lib');
        try {
            bitcoin.Address.fromBase58Check(val);
            return true;
        }
        catch (err) {
            return false;
        }
    },
    ethereum: function (val) {
        return /^0x[0-9a-fA-F]*$/.test(val);
    }
};
exports.amount = {
    bitcoin: engine_1.typeforce.Number,
    ethereum: function (val) {
        return /^0x[0-9a-fA-F]*$/.test(val);
    }
};
//# sourceMappingURL=typeforce-types.js.map