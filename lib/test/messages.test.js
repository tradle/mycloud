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
require('./env').install();
const AWS = require("aws-sdk");
AWS.config.paramValidation = false;
const yn = require("yn");
const test = require("tape");
const sinon = require("sinon");
const tradle = require("@tradle/engine");
const crypto_1 = require("../crypto");
const utils_1 = require("../utils");
const Errors = require("../errors");
const constants_1 = require("../constants");
const _1 = require("../");
const types = require("../typeforce-types");
const { newIdentity } = tradle.utils;
const { MESSAGE } = constants_1.TYPES;
const { identities, messages, objects, provider } = _1.createTestTradle();
const { _doSendMessage, _doReceiveMessage } = provider;
const fromBobToAlice = require('./fixtures/alice/receive.json')
    .map(messages.normalizeInbound);
const fromAliceToBob = require('./fixtures/bob/receive.json')
    .map(messages.normalizeInbound);
const promiseNoop = () => Promise.resolve();
const [alice, bob] = ['alice', 'bob'].map(name => {
    const identity = require(`./fixtures/${name}/identity`);
    return {
        identity: crypto_1.withLinks(identity),
        keys: require(`./fixtures/${name}/keys`)
    };
});
test('extract pub key', function (t) {
    const { identity } = alice;
    const { curve, pub } = crypto_1.extractSigPubKey(identity);
    const expected = identity.pubkeys.find(key => {
        return key.purpose === 'update';
    });
    t.equal(curve, expected.curve);
    t.equal(pub, expected.pub);
    identity.blah = 'blah';
    try {
        crypto_1.extractSigPubKey(identity);
        t.fail('validated invalid signature');
    }
    catch (err) {
        t.ok(err instanceof Errors.InvalidSignature);
    }
    t.end();
});
test('_doSendMessage', utils_1.loudAsync((t) => __awaiter(this, void 0, void 0, function* () {
    const payload = {
        [constants_1.TYPE]: 'tradle.SimpleMessage',
        message: 'hey bob',
    };
    const stub = stubber();
    stub(identities, 'byPermalink', mocks.byPermalink);
    let nextSeq = 0;
    let prevMsgLink = 'abc';
    const stubLastSeqAndLink = sinon.stub(messages, 'getLastSeqAndLink')
        .callsFake(() => Promise.resolve({
        seq: nextSeq - 1,
        link: prevMsgLink
    }));
    const stubPutObject = stub(objects, 'put', function (object) {
        t.ok(object[constants_1.SIG]);
        payload[constants_1.SIG] = object[constants_1.SIG];
        t.same(utils_1.omitVirtual(object), payload);
        return Promise.resolve();
    });
    let stoleSeq;
    const stubPutMessage = stub(messages, 'putMessage', utils_1.co(function* (message) {
        utils_1.typeforce(types.message, message);
        t.notOk(message._inbound);
        t.equal(message[constants_1.SEQ], nextSeq);
        t.equal(message[constants_1.PREV_TO_RECIPIENT], prevMsgLink);
        if (!stoleSeq) {
            nextSeq++;
            stoleSeq = true;
            const err = new Error();
            err.code = 'ConditionalCheckFailedException';
            throw err;
        }
        t.end();
    }));
    const event = yield _doSendMessage({
        time: Date.now(),
        author: alice,
        recipient: bob.identity._permalink,
        object: payload
    });
    t.equal(stubPutObject.callCount, 1);
    t.equal(stubPutMessage.callCount, 2);
    t.equal(stubLastSeqAndLink.callCount, 2);
    stub.restore();
})));
test('_doReceiveMessage', utils_1.loudAsync((t) => __awaiter(this, void 0, void 0, function* () {
    const message = fromBobToAlice[0];
    const stub = stubber();
    const stubGetIdentity = stub(identities, 'metaByPub', mocks.metaByPub);
    const stubPutObject = stub(objects, 'put', function (object) {
        t.ok(object[constants_1.SIG]);
        t.same(object, message.object);
        return Promise.resolve();
    });
    const stubTimestampInc = stub(messages, 'assertTimestampIncreased', promiseNoop);
    const stubGetInbound = stub(messages, 'getInboundByLink', function (link) {
        throw new Errors.NotFound();
    });
    const stubPutMessage = stub(messages, 'putMessage', function (message) {
        t.equal(message._inbound, true);
        utils_1.typeforce(types.message, message);
        return Promise.resolve();
    });
    yield _doReceiveMessage({ message });
    t.equal(stubPutMessage.callCount, 1);
    t.equal(stubPutObject.callCount, 1);
    t.equal(stubGetIdentity.callCount, 2);
    t.equal(stubGetInbound.callCount, 0);
    t.equal(stubTimestampInc.callCount, yn(process.env.NO_TIME_TRAVEL) ? 1 : 0);
    stub.restore();
    t.end();
})));
const mocks = {
    byPermalink: utils_1.co(function* (permalink) {
        if (permalink === alice.identity._permalink) {
            return alice.identity;
        }
        if (permalink === bob.identity._permalink) {
            return bob.identity;
        }
        throw new Errors.NotFound('identity not found by permalink: ' + permalink);
    }),
    byPub: utils_1.co(function* (pub) {
        const found = [alice, bob].find(info => {
            return info.identity.pubkeys.some(key => key.pub === pub);
        });
        if (found)
            return found.identity;
        throw new Errors.NotFound('identity not found by pub: ' + pub);
    }),
    metaByPub: utils_1.co(function* (pub) {
        const found = [alice, bob].find(info => {
            return info.identity.pubkeys.some(key => key.pub === pub);
        });
        if (found) {
            return {
                link: found.identity._link,
                permalink: found.identity._permalink
            };
        }
        throw new Errors.NotFound('identity not found by pub: ' + pub);
    })
};
function stubber() {
    const stubs = [];
    const stub = (obj, prop, fn) => {
        const thisStub = sinon.stub(obj, prop).callsFake(fn);
        stubs.push(thisStub);
        return thisStub;
    };
    stub.restore = () => stubs.forEach(stub => stub.restore());
    return stub;
}
//# sourceMappingURL=messages.test.js.map