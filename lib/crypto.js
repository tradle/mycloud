const crypto = require('crypto');
const stringify = require('json-stable-stringify');
const KeyEncoder = require('key-encoder');
const pify = require('pify');
const { protocol, utils, constants } = require('@tradle/engine');
const doSign = pify(protocol.sign.bind(protocol));
const { SIG, TYPE, TYPES } = constants;
const { IDENTITY } = TYPES;
const { toBuffer, loudCo, extend, omit, omitVirtual, setVirtual, wrap } = require('./utils');
const { InvalidSignature } = require('./errors');
const { IDENTITY_KEYS_KEY, PERMALINK, PREVLINK } = require('./constants');
const SIGN_WITH_HASH = 'sha256';
const ENC_ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const SALT_BYTES = 32;
const encoders = {};
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
function rawSign(key, data) {
    return crypto
        .createSign(SIGN_WITH_HASH)
        .update(toBuffer(data))
        .sign(key, 'hex');
}
function keyToSigner({ curve, pub, encoded }) {
    const { priv } = encoded.pem;
    return {
        sigPubKey: {
            curve,
            pub: new Buffer(pub, 'hex')
        },
        sign: wrap(data => rawSign(priv, data))
    };
}
function getSigningKey(keys) {
    return keys.find(key => key.type === 'ec' && key.purpose === 'sign');
}
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
const sign = loudCo(function* ({ key, object }) {
    const { pub, priv } = key;
    const author = keyToSigner(key);
    const result = yield doSign({
        object: omitVirtual(object),
        author
    });
    return setVirtual(result.object, {
        _sigPubKey: author.sigPubKey.pub.toString('hex')
    });
});
function extractSigPubKey(object) {
    const pubKey = utils.extractSigPubKey(omitVirtual(object));
    if (pubKey) {
        return {
            type: 'ec',
            curve: pubKey.curve,
            pub: pubKey.pub.toString('hex')
        };
    }
    throw new InvalidSignature('unable to extract pub key from object');
}
function checkAuthentic(wrapper) {
    const { object, link, author, sigPubKey } = wrapper;
    const expectedPurpose = object[TYPE] === IDENTITY ? 'update' : 'sign';
    if (sigPubKey.purpose !== expectedPurpose) {
        throw new InvalidSignature(`expected key with purpose "${expectedPurpose}", got "${sigPubKey.purpose}"`);
    }
    if (!utils.findPubKey(author.object, sigPubKey)) {
        throw new InvalidSignature(`identity doesn't contain signing key`);
    }
}
function exportKeys(keys) {
    return keys.map(exportKey);
}
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
function randomString(bytes, enc = 'hex') {
    return crypto.randomBytes(bytes).toString('hex');
}
function calcLink(object) {
    return utils.hexLink(omitVirtual(object));
}
function getLink(object) {
    return object._link || calcLink(object);
}
function getLinks(object) {
    const link = getLink(object);
    return {
        link,
        permalink: getPermalink(object),
        prevlink: object[PREVLINK]
    };
}
function getPermalink(object) {
    return object[PERMALINK] || getLink(object);
}
function addLinks(object) {
    const links = getLinks(object);
    setVirtual(object, {
        _link: links.link,
        _permalink: links.permalink
    });
    return links;
}
function withLinks(object) {
    addLinks(object);
    return object;
}
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
module.exports = {
    checkAuthentic,
    extractSigPubKey,
    sign,
    getSigningKey,
    getChainKey,
    encrypt,
    decrypt,
    exportKeys,
    sha256,
    getLink,
    getPermalink,
    getLinks,
    addLinks,
    withLinks,
    randomString,
    getIdentitySpecs
};
//# sourceMappingURL=crypto.js.map