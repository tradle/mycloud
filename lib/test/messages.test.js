require('./env').install();
const AWS = require('aws-sdk');
AWS.config.paramValidation = false;
const test = require('tape');
const pify = require('pify');
const ecdsa = require('nkey-ecdsa');
const sinon = require('sinon');
const tradle = require('@tradle/engine');
const { newIdentity } = tradle.utils;
const wrap = require('../wrap');
const { extractSigPubKey, exportKeys, getSigningKey, sign, getLink, withLinks } = require('../crypto');
const { loudCo, omit, clone, co, typeforce, pickVirtual, omitVirtual } = require('../utils');
const Errors = require('../errors');
const { SIG, SEQ, PREV_TO_RECIPIENT, TYPE, TYPES } = require('../constants');
const { MESSAGE } = TYPES;
const { identities, messages, objects, provider } = require('../').createTestTradle();
const { createSendMessageEvent, createReceiveMessageEvent } = provider;
const types = require('../typeforce-types');
const fromBobToAlice = require('./fixtures/alice/receive.json')
    .map(messages.normalizeInbound);
const fromAliceToBob = require('./fixtures/bob/receive.json')
    .map(messages.normalizeInbound);
const promiseNoop = () => Promise.resolve();
const [alice, bob] = ['alice', 'bob'].map(name => {
    const identity = require(`./fixtures/${name}/identity`);
    return {
        identity: withLinks(identity),
        keys: require(`./fixtures/${name}/keys`)
    };
});
test('extract pub key', function (t) {
    const { identity } = alice;
    const { curve, pub } = extractSigPubKey(identity);
    const expected = identity.pubkeys.find(key => {
        return key.purpose === 'update';
    });
    t.equal(curve, expected.curve);
    t.equal(pub, expected.pub);
    identity.blah = 'blah';
    try {
        extractSigPubKey(identity);
        t.fail('validated invalid signature');
    }
    catch (err) {
        t.ok(err instanceof Errors.InvalidSignature);
    }
    t.end();
});
test('createSendMessageEvent', loudCo(function* (t) {
    const payload = {
        [TYPE]: 'tradle.SimpleMessage',
        message: 'hey bob',
    };
    const stub = stubber();
    stub(identities, 'getIdentityByPermalink', mocks.getIdentityByPermalink);
    let nextSeq = 0;
    let prevMsgLink = 'abc';
    const stubLastSeqAndLink = sinon.stub(messages, 'getLastSeqAndLink')
        .callsFake(() => Promise.resolve({
        seq: nextSeq - 1,
        link: prevMsgLink
    }));
    const stubPutObject = stub(objects, 'put', function (object) {
        t.ok(object[SIG]);
        payload[SIG] = object[SIG];
        t.same(omitVirtual(object), payload);
        return Promise.resolve();
    });
    let stoleSeq;
    const stubPutMessage = stub(messages, 'putMessage', co(function* (message) {
        typeforce(types.message, message);
        t.notOk(message._inbound);
        t.equal(message[SEQ], nextSeq);
        t.equal(message[PREV_TO_RECIPIENT], prevMsgLink);
        if (!stoleSeq) {
            nextSeq++;
            stoleSeq = true;
            const err = new Error();
            err.code = 'ConditionalCheckFailedException';
            throw err;
        }
        t.end();
    }));
    const event = yield createSendMessageEvent({
        time: Date.now(),
        author: alice,
        recipient: bob.identity._permalink,
        object: payload
    });
    t.equal(stubPutObject.callCount, 1);
    t.equal(stubPutMessage.callCount, 2);
    t.equal(stubLastSeqAndLink.callCount, 2);
    stub.restore();
}));
test('createReceiveMessageEvent', loudCo(function* (t) {
    const message = fromBobToAlice[0];
    const stub = stubber();
    const stubGetIdentity = stub(identities, 'getIdentityMetadataByPub', mocks.getIdentityMetadataByPub);
    const stubPutObject = stub(objects, 'put', function (object) {
        t.ok(object[SIG]);
        t.same(object, message.object);
        return Promise.resolve();
    });
    const stubTimestampInc = stub(messages, 'assertTimestampIncreased', promiseNoop);
    const stubGetInbound = stub(messages, 'getInboundByLink', function (link) {
        throw new Errors.NotFound();
    });
    const stubPutMessage = stub(messages, 'putMessage', function (message) {
        t.equal(message._inbound, true);
        typeforce(types.message, message);
        return Promise.resolve();
    });
    yield createReceiveMessageEvent({ message });
    t.equal(stubPutMessage.callCount, 1);
    t.equal(stubPutObject.callCount, 1);
    t.equal(stubGetIdentity.callCount, 2);
    t.equal(stubGetInbound.callCount, 0);
    t.equal(stubTimestampInc.callCount, process.env.NO_TIME_TRAVEL ? 1 : 0);
    stub.restore();
    t.end();
}));
test.skip('getLastMessageFrom/To', loudCo(function* (t) {
    try {
        yield messages.table.destroy();
    }
    catch (err) { }
    yield messages.table.create();
    console.log('ALICE', alice.identity._permalink);
    console.log('BOB', bob.identity._permalink);
    for (let message of fromBobToAlice) {
        message = clone(message);
        message._inbound = true;
        yield messages.putMessage(message);
        const last = yield messages.getLastMessageFrom({
            author: bob.identity._permalink,
            body: false
        });
        t.same(last, messages.stripData(message));
    }
    for (let message of fromAliceToBob) {
        yield messages.putMessage(message);
        const last = yield messages.getLastMessageTo({
            recipient: bob.identity._permalink,
            body: false
        });
        t.same(last, messages.stripData(message));
    }
    t.end();
}));
const mocks = {
    getIdentityByPermalink: co(function* (permalink) {
        if (permalink === alice.identity._permalink) {
            return alice.identity;
        }
        if (permalink === bob.identity._permalink) {
            return bob.identity;
        }
        throw new Errors.NotFound('identity not found by permalink: ' + permalink);
    }),
    getIdentityByPub: co(function* (pub) {
        const found = [alice, bob].find(info => {
            return info.identity.pubkeys.some(key => key.pub === pub);
        });
        if (found)
            return found.identity;
        throw new Errors.NotFound('identity not found by pub: ' + pub);
    }),
    getIdentityMetadataByPub: co(function* (pub) {
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