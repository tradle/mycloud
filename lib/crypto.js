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
require('source-map-support').install();
const crypto = require("crypto");
const KeyEncoder = require("key-encoder");
const pify = require("pify");
const engine_1 = require("@tradle/engine");
const utils_1 = require("./utils");
const errors_1 = require("./errors");
const constants_1 = require("./constants");
const doSign = pify(engine_1.protocol.sign.bind(engine_1.protocol));
const { SIG, TYPE, TYPES } = engine_1.constants;
const { IDENTITY } = TYPES;
const SIGN_WITH_HASH = 'sha256';
const ENC_ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const SALT_BYTES = 32;
const encoders = {};
class ECKey {
    constructor(keyJSON) {
        this.toJSON = (exportPrivate) => {
            const json = utils_1.deepClone(this.keyJSON);
            if (!exportPrivate) {
                delete json.priv;
                delete json.encoded.pem.priv;
            }
            return json;
        };
        this.keyJSON = keyJSON;
        const { curve, pub, encoded } = keyJSON;
        if (!encoded) {
            throw new Error('expected "encoded"');
        }
        const { pem } = encoded;
        this.signSync = data => rawSign(pem.priv, data);
        this.sign = utils_1.wrap(this.signSync);
        this.promiseSign = (data) => __awaiter(this, void 0, void 0, function* () { return this.signSync(data); });
        this.verifySync = (data, sig) => rawVerify(pem.pub, data, sig);
        this.verify = utils_1.wrap(this.verifySync);
        this.promiseVerify = (data, sig) => __awaiter(this, void 0, void 0, function* () { return this.verifySync(data, sig); });
        this.sigPubKey = {
            curve,
            pub: new Buffer(pub, 'hex')
        };
    }
}
exports.ECKey = ECKey;
function decryptKey({ aws, encryptedKey }) {
    return aws.kms.decrypt({
        CiphertextBlob: encryptedKey
    })
        .promise()
        .then(data => data.Plaintext.toString());
}
function encrypt({ data, key, salt }) {
    if (key.length !== KEY_BYTES)
        throw new Error(`expected key length: ${KEY_BYTES} bytes`);
    if (salt && salt.length !== SALT_BYTES) {
        throw new Error(`expected salt length: ${SALT_BYTES} bytes`);
    }
    if (!salt)
        salt = crypto.randomBytes(SALT_BYTES);
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ENC_ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    return serialize(ciphertext, salt, tag, iv);
}
exports.encrypt = encrypt;
function serialize(...buffers) {
    const parts = [];
    let idx = 0;
    buffers.forEach(function (part) {
        const len = new Buffer(4);
        if (typeof part === 'string')
            part = new Buffer(part);
        len.writeUInt32BE(part.length, 0);
        parts.push(len);
        idx += len.length;
        parts.push(part);
        idx += part.length;
    });
    return Buffer.concat(parts);
}
function unserialize(buf) {
    const parts = [];
    const l = buf.length;
    let idx = 0;
    while (idx < l) {
        let dlen = buf.readUInt32BE(idx);
        idx += 4;
        let start = idx;
        let end = start + dlen;
        let part = buf.slice(start, end);
        parts.push(part);
        idx += part.length;
    }
    const [ciphertext, salt, tag, iv] = parts;
    return {
        ciphertext,
        salt,
        tag,
        iv
    };
}
function decrypt({ key, data }) {
    const [ciphertext, salt, tag, iv] = unserialize(data);
    const decipher = crypto.createDecipheriv(ENC_ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final()
    ]);
}
exports.decrypt = decrypt;
function rawSign(key, data) {
    return crypto
        .createSign(SIGN_WITH_HASH)
        .update(utils_1.toBuffer(data))
        .sign(key, 'hex');
}
exports.rawSign = rawSign;
function rawVerify(key, data, sig) {
    if (typeof sig === 'string') {
        sig = new Buffer(sig, 'hex');
    }
    return crypto
        .createVerify(SIGN_WITH_HASH)
        .update(utils_1.toBuffer(data))
        .verify(key, sig);
}
exports.rawVerify = rawVerify;
function getSigningKey(keys) {
    const key = keys.find(key => key.type === 'ec' && key.purpose === 'sign');
    return new ECKey(key);
}
exports.getSigningKey = getSigningKey;
function getChainKey(keys, props = {}) {
    return keys.find(key => {
        if (key.purpose !== 'messaging' || !key.networkName)
            return;
        for (let p in props) {
            if (props[p] !== key[p])
                return;
        }
        return key;
    });
}
exports.getChainKey = getChainKey;
const sign = utils_1.loudCo(function* ({ key, object }) {
    const author = key instanceof ECKey ? key : new ECKey(key);
    const result = yield doSign({
        object: utils_1.omitVirtual(object),
        author
    });
    return utils_1.setVirtual(result.object, {
        _sigPubKey: author.sigPubKey.pub.toString('hex')
    });
});
exports.sign = sign;
function extractSigPubKey(object) {
    const pubKey = engine_1.utils.extractSigPubKey(utils_1.omitVirtual(object));
    if (pubKey) {
        return {
            type: 'ec',
            curve: pubKey.curve,
            pub: pubKey.pub.toString('hex')
        };
    }
    throw new errors_1.InvalidSignature('unable to extract pub key from object');
}
exports.extractSigPubKey = extractSigPubKey;
function checkAuthentic(wrapper) {
    const { object, link, author, sigPubKey } = wrapper;
    const expectedPurpose = object[TYPE] === IDENTITY ? 'update' : 'sign';
    if (sigPubKey.purpose !== expectedPurpose) {
        throw new errors_1.InvalidSignature(`expected key with purpose "${expectedPurpose}", got "${sigPubKey.purpose}"`);
    }
    if (!engine_1.utils.findPubKey(author.object, sigPubKey)) {
        throw new errors_1.InvalidSignature(`identity doesn't contain signing key`);
    }
}
exports.checkAuthentic = checkAuthentic;
function exportKeys(keys) {
    return keys.map(exportKey);
}
exports.exportKeys = exportKeys;
function exportKey(key) {
    key = key.toJSON(true);
    if (key.type !== 'ec' || key.curve === 'curve25519')
        return key;
    const encoder = getEncoder(key.curve);
    key.encoded = {
        pem: {
            priv: encoder.encodePrivate(new Buffer(key.priv, 'hex'), 'raw', 'pem'),
            pub: encoder.encodePublic(new Buffer(key.pub, 'hex'), 'raw', 'pem')
        }
    };
    return key;
}
function getEncoder(curve) {
    if (!encoders[curve]) {
        encoders[curve] = new KeyEncoder(curve);
    }
    return encoders[curve];
}
function sha256(data, enc = 'base64') {
    return crypto.createHash('sha256').update(data).digest(enc);
}
exports.sha256 = sha256;
function randomString(bytes, enc = 'hex') {
    return crypto.randomBytes(bytes).toString('hex');
}
exports.randomString = randomString;
function calcLink(object) {
    return engine_1.utils.hexLink(utils_1.omitVirtual(object));
}
function getLink(object) {
    return object._link || calcLink(object);
}
exports.getLink = getLink;
function getLinks(object) {
    const link = getLink(object);
    return {
        link,
        permalink: getPermalink(object),
        prevlink: object[constants_1.PREVLINK]
    };
}
exports.getLinks = getLinks;
function getPermalink(object) {
    return object[constants_1.PERMALINK] || getLink(object);
}
exports.getPermalink = getPermalink;
function addLinks(object) {
    const links = getLinks(object);
    utils_1.setVirtual(object, {
        _link: links.link,
        _permalink: links.permalink
    });
    return links;
}
exports.addLinks = addLinks;
function withLinks(object) {
    addLinks(object);
    return object;
}
exports.withLinks = withLinks;
function getIdentitySpecs({ networks }) {
    const nets = {};
    for (let flavor in networks) {
        if (!nets[flavor]) {
            nets[flavor] = [];
        }
        let constants = networks[flavor];
        for (let networkName in constants) {
            nets[flavor].push(networkName);
        }
    }
    return { networks: nets };
}
exports.getIdentitySpecs = getIdentitySpecs;
//# sourceMappingURL=crypto.js.map