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
if (process.env.NODE_ENV === 'test') {
    require('xtend/mutable')(process.env, require('../../test/service-map'));
}
const mockery = require('mockery');
mockery.enable({
    warnOnReplace: false,
    warnOnUnregistered: false
});
mockery.registerSubstitute('q', 'bluebird-q');
const co = require('co').wrap;
const debug = require('debug')('λ:clienttest');
const randomName = require('random-name');
const Client = require('@tradle/aws-client');
const { utils } = require('@tradle/engine');
const helpers = require('@tradle/engine/test/helpers');
const validateResource = require('@tradle/validate-resource');
const tradle = require('../').tradle;
const { resources } = tradle;
const { RestAPI } = resources;
const getMe = tradle.provider.getMyIdentity();
const { getLink, getPermalink } = require('../crypto');
const { omitVirtual, wrap } = require('../utils');
const lambda_1 = require("../lambda");
const allUsers = require('../test/fixtures/users').slice(4);
const lambda = new lambda_1.Lambda({ tradle, source: lambda_1.EventSource.LAMBDA });
lambda.use(({ event = {}, context }) => __awaiter(this, void 0, void 0, function* () {
    const { concurrency = 1, offset = 0 } = event;
    const nodes = makeNodes(concurrency, offset);
    yield Promise.all(nodes.map(pingPong));
}));
exports.handler = lambda.handler;
const pingPong = co(function* (node, i) {
    const promisePong = awaitType(node, 'tradle.Pong');
    const me = yield getMe;
    const permalink = getPermalink(me);
    const realMe = omitVirtual(me);
    const client = new Client({
        node,
        counterparty: permalink,
        endpoint: RestAPI.ApiGateway,
        clientId: `${node.permalink}${node.permalink}`
    });
    const promiseAck = new Promise(resolve => client.once('ack', resolve));
    client.on('error', err => {
        throw err;
    });
    client.onmessage = co(function* (msg) {
        debug(`receiving ${msg.object._t} ${getLink(msg)} from ${permalink}`);
        yield node.receive(msg, { permalink });
    });
    node._send = wrap(function* (message, recipientInfo) {
        yield client.send({
            message,
            link: message.unserialized.link
        });
    });
    yield node.addContact(realMe);
    yield client.ready();
    yield node.signAndSend({
        to: { permalink },
        object: {
            _t: 'tradle.SelfIntroduction',
            identity: node.identity
        }
    });
    yield node.signAndSend({
        to: { permalink },
        object: {
            _t: 'tradle.Ping'
        }
    });
    yield promiseAck;
    debug('delivered SelfIntroduction');
    yield promisePong;
    debug('received pong');
    yield node.destroy();
    yield client.close();
});
function awaitType(node, type) {
    return awaitEvent(node, 'message', ({ object }) => object.object._t === type);
}
function awaitEvent(node, event, filter = acceptAll) {
    return new Promise(resolve => {
        node.on(event, checkEvent);
        function checkEvent(data) {
            if (filter(data)) {
                node.removeListener('event', checkEvent);
                resolve();
            }
        }
    });
}
function acceptAll() {
    return true;
}
function makeNodes(n, offset) {
    let blockchain;
    if (allUsers.length < n + offset) {
        throw new Error('not enough users in fixtures');
    }
    return allUsers.slice(offset, n).map((user, i) => {
        const opts = helpers.userToOpts(user, user.profile.name.firstName);
        opts.blockchain = blockchain;
        const node = helpers.createNode(opts);
        if (!blockchain)
            blockchain = node.blockchain;
        return utils.promisifyNode(node);
    });
}
if (process.env.NODE_ENV === 'test') {
    exports.handler({}, {}, err => {
        if (err)
            console.error(err);
    });
}
//# sourceMappingURL=clienttest.js.map