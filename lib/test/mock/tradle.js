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
const _1 = require("../../");
const utils_1 = require("../utils");
const fakeSeals = require("./seals");
const env_1 = require("../../env");
const tradle = _1.createTestTradle();
const { errors, constants, utils, aws, db } = tradle;
const { extend } = utils;
const promiseNoop = () => __awaiter(this, void 0, void 0, function* () { });
const noop = () => { };
module.exports = function fakeTradle({ env, conf, kv, objects, identities, messages, send }) {
    const seals = {};
    const inbox = {};
    const outbox = {};
    return {
        init: { init: noop },
        env: env || new env_1.default(process.env),
        aws,
        errors,
        constants,
        conf,
        kv,
        seals: fakeSeals({
            seals
        }),
        db,
        router: tradle.router,
        objects: {
            get: utils_1.getter(objects),
            getEmbeds: () => {
                throw new Error('mock getEmbeds not implemented');
            },
            resolveEmbeds: () => {
                throw new Error('mock resolveEmbeds not implemented');
            },
            presignUrls: () => {
                throw new Error('mock presignUrls not implemented');
            },
            presignEmbeddedMediaLinks: () => {
                throw new Error('mock presignEmbeddedMediaLinks not implemented');
            }
        },
        identities: {
            byPermalink: utils_1.getter(identities),
            addAuthorInfo: () => {
                throw new Error('mock addAuthorInfo not implemented');
            }
        },
        messages: {},
        provider: {
            sendMessage: (args) => __awaiter(this, void 0, void 0, function* () {
                const { to, object, other = {} } = args;
                if (!outbox[to])
                    outbox[to] = [];
                outbox[to].push(extend({
                    _author: 'bot',
                    _link: 'abc',
                    _permalink: 'abc',
                    recipientPubKey: {}
                }, other));
                yield send(args);
            }),
            getMyChainKey: promiseNoop
        }
    };
};
//# sourceMappingURL=tradle.js.map