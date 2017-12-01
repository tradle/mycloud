const { types, typeforce } = require('@tradle/engine');
const { identity } = types;
const { TYPE, PREV_TO_RECIPIENT, SEQ, SIG } = require('./constants');
function link(val) {
    return typeof val === 'string' && val.length === 64;
}
exports.link = link;
exports.permalink = link;
exports.privateKey = typeforce.compile({
    pub: typeforce.String,
    priv: typeforce.String
});
exports.author = typeforce.compile({
    identity,
    keys: typeforce.arrayOf(exports.privateKey)
});
exports.identity = identity;
exports.hasType = function hasType(obj) {
    if (!obj[TYPE]) {
        throw new Error(`expected string ${TYPE}`);
    }
    return true;
};
exports.hasTimestamp = function hasType(obj) {
    if (typeof obj._time !== 'number') {
        throw new Error(`expected timestamp "_time"`);
    }
    return true;
};
exports.signedObject = function signedObject(obj) {
    typeforce(types.signedObject, obj);
    typeforce(exports.hasType, obj);
    return true;
};
exports.unsignedObject = function unsignedObject(obj) {
    typeforce(types.rawObject, obj);
    typeforce(exports.hasType, obj);
    return true;
};
exports.message = typeforce.compile({
    [SEQ]: typeforce.Number,
    [SIG]: typeforce.String,
    object: types.signedObject,
    [PREV_TO_RECIPIENT]: typeforce.maybe(typeforce.String),
    recipientPubKey: types.ecPubKey,
    time: typeforce.Number,
    _author: typeforce.maybe(link),
    _recipient: typeforce.maybe(link),
    _link: typeforce.maybe(link),
    _permalink: typeforce.maybe(link),
    _inbound: typeforce.maybe(typeforce.Boolean),
});
exports.messageStub = typeforce.compile({
    time: typeforce.Number,
    link: link
});
exports.position = typeforce.compile({
    time: typeforce.maybe(exports.messageStub),
    received: typeforce.maybe(exports.messageStub)
});
exports.blockchain = typeforce.compile({
    flavor: typeforce.String,
    networkName: typeforce.String,
    pubKeyToAddress: typeforce.Function,
    seal: typeforce.Function
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
    bitcoin: typeforce.Number,
    ethereum: function (val) {
        return /^0x[0-9a-fA-F]*$/.test(val);
    }
};
//# sourceMappingURL=typeforce-types.js.map