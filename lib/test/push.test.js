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
const crypto = require("crypto");
const test = require("tape");
const nock = require("nock");
const buildResource = require("@tradle/build-resource");
const push_1 = require("../push");
const logger_1 = require("../logger");
const utils_1 = require("./utils");
const crypto_1 = require("../crypto");
const alice = require("./fixtures/alice/identity");
const aliceKeys = require("./fixtures/alice/keys");
const _1 = require("../");
test('push', utils_1.loudAsync((t) => __awaiter(this, void 0, void 0, function* () {
    const serverUrl = 'http://localhost:12345';
    const key = crypto_1.getSigningKey(aliceKeys);
    const nonce = crypto.randomBytes(10).toString('hex');
    let preregistered;
    let registered;
    let pushed;
    nock(serverUrl)
        .post('/publisher')
        .reply((uri, body) => {
        preregistered = true;
        t.same(body, {
            identity: alice,
            key: key.toJSON()
        });
        return nonce;
    });
    nock(serverUrl)
        .post('/publisher')
        .reply((uri, body) => {
        registered = true;
        t.ok(body.nonce && body.salt && body.sig);
        t.equal(body.nonce, nonce);
        const challenge = push_1.getChallenge({ nonce, salt: body.salt });
        t.ok(key.verifySync(challenge, body.sig));
    });
    const namespace = 'test' + Date.now();
    const push = new push_1.default({
        serverUrl,
        conf: _1.tradle.conf.sub(namespace),
        logger: new logger_1.default()
    });
    t.equal(yield push.isRegistered(), false);
    yield push.register({
        identity: alice,
        key
    });
    t.equal(preregistered, true);
    t.equal(registered, true);
    t.equal(yield push.isRegistered(), true);
    const subscriber = 'bob';
    const getNotificationRequest = (uri, body) => {
        pushed = true;
        t.equal(body.publisher, buildResource.permalink(alice));
        t.equal(body.subscriber, subscriber);
        const data = push_1.getNotificationData(body);
        t.ok(key.verifySync(data, body.sig));
    };
    nock(serverUrl)
        .post('/notification')
        .reply(getNotificationRequest);
    t.same(yield push.getSubscriber(subscriber), { seq: -1 });
    yield push.push({
        identity: alice,
        key,
        subscriber
    });
    t.equal(pushed, true);
    t.same(yield push.getSubscriber(subscriber), { seq: 0 });
    nock(serverUrl)
        .post('/notification')
        .reply(getNotificationRequest);
    yield push.push({
        identity: alice,
        key,
        subscriber
    });
    t.same(yield push.getSubscriber(subscriber), { seq: 1 });
    nock(serverUrl)
        .post('/notification')
        .reply((uri, body) => {
        return [
            400,
            'subscriber not found'
        ];
    });
    try {
        yield push.push({
            identity: alice,
            key,
            subscriber
        });
        t.fail('expected failure');
    }
    catch (err) {
        t.ok(err);
    }
    t.same(yield push.getSubscriber(subscriber), { seq: 2, errorCount: 1 });
    t.end();
})));
//# sourceMappingURL=push.test.js.map