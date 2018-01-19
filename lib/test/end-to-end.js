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
const Promise = require("bluebird");
const _ = require("lodash");
const IotMessage = require("@tradle/iot-message");
const nock = require('nock');
const assert = require('assert');
const nodeCrypto = require('crypto');
const inherits = require('inherits');
const { EventEmitter } = require('events');
const coexec = require('co');
const co = require('co').wrap;
const { TYPE, TYPES, SIG, SEQ } = require('@tradle/constants');
const { MESSAGE } = TYPES;
const buildResource = require('@tradle/build-resource');
const validateResource = require("@tradle/validate-resource");
const mergeModels = require('@tradle/merge-models');
const tradleUtils = require('@tradle/engine').utils;
const createProductsStrategy = require('@tradle/bot-products');
const createEmployeeManager = require('@tradle/bot-employee-manager');
const genSample = require('@tradle/gen-samples').fake;
const { replaceDataUrls } = require('@tradle/embed');
const onmessage = require("../samplebot/lambda/mqtt/onmessage");
const { genLocalResources } = require('../cli/utils');
const { wrap, utils, crypto } = require('../');
const intercept = require('./interceptor');
const Errors = require('../errors');
const { createTestProfile } = require('./utils');
const defaultTradleInstance = require('../').tradle;
const genIdentity = (tradle) => __awaiter(this, void 0, void 0, function* () {
    const { identity, keys } = (yield tradle.init.genIdentity()).priv;
    return {
        identity,
        keys,
        profile: createTestProfile()
    };
});
const baseModels = require('../models');
const DEFAULT_PRODUCT = 'nl.tradle.DigitalPassport';
const SIMPLE_MESSAGE = 'tradle.SimpleMessage';
const APPLICATION = 'tradle.Application';
class Test {
    constructor({ tradle = defaultTradleInstance, products, bot, productsAPI, employeeManager }) {
        this._init = () => __awaiter(this, void 0, void 0, function* () {
            yield this.tradle.init.ensureInitialized();
            this.bot.identity = yield this.bot.getMyIdentity();
            yield this.bot.addressBook.addContact(this.bot.identity);
            this.bot.ready();
            this.debug('bot permalink', crypto.getPermalink(this.bot.identity));
        });
        this.runEmployeeAndCustomer = wrapWithIntercept((opts = {}) => __awaiter(this, void 0, void 0, function* () {
            yield this._ready;
            const { product = DEFAULT_PRODUCT } = opts;
            const { tradle, bot } = this;
            const [employee, customer] = yield Promise.all([
                createUser({ bot, tradle, name: 'employee' }),
                createUser({ bot, tradle, name: 'customer' })
            ]);
            const employeeApp = yield this.onboardEmployee({ user: employee });
            employee.on('message', (message) => __awaiter(this, void 0, void 0, function* () {
                if (message.object[TYPE] === MESSAGE) {
                    message = message.object;
                }
                else {
                    return;
                }
                const hey = {
                    [TYPE]: SIMPLE_MESSAGE,
                    message: 'hey'
                };
                message = _.cloneDeep(message);
                yield bot.identities.addAuthorInfo(message);
                yield employee.send({
                    other: {
                        forward: message._author
                    },
                    object: hey
                });
            }));
            return yield this.onboardCustomer({
                user: customer,
                relationshipManager: employee,
                product
            });
        }));
        this.genIdentity = () => __awaiter(this, void 0, void 0, function* () {
            return yield genIdentity(this.tradle);
        });
        this.runEmployeeAndFriend = wrapWithIntercept(() => __awaiter(this, void 0, void 0, function* () {
            yield this._ready;
            const { bot, tradle, productsAPI } = this;
            const employee = yield createUser({ bot, tradle, name: 'employee' });
            yield this.onboardEmployee({ user: employee });
            const { friends } = bot;
            const url = 'http://localhost:12345';
            const { identity } = yield this.genIdentity();
            const friend = {
                name: 'friendly bank',
                identity,
                url
            };
            yield friends.add(friend);
            const hey = {
                [TYPE]: SIMPLE_MESSAGE,
                message: 'hey'
            };
            const identityPermalink = buildResource.permalink(friend.identity);
            this.interceptor.httpOnly(identityPermalink);
            nock(url)
                .post('/inbox')
                .reply(function (uri, body) {
                const { messages } = body;
                assert.equal(messages.length, 1);
                const msg = messages[0];
                assert.equal(msg.object[TYPE], SIMPLE_MESSAGE);
                assert.deepEqual(_.pick(msg.object, Object.keys(hey)), hey);
                return [
                    201
                ];
            });
            yield employee.send({
                other: {
                    forward: identityPermalink
                },
                object: hey
            });
        }));
        this.onboardEmployee = ({ user }) => __awaiter(this, void 0, void 0, function* () {
            return yield this.runThroughApplication({
                user,
                awaitCertificate: true,
                product: 'tradle.EmployeeOnboarding'
            });
        });
        this.onboardCustomer = ({ user, relationshipManager, product }) => __awaiter(this, void 0, void 0, function* () {
            const { bot, models } = this;
            if (relationshipManager) {
                let context;
                relationshipManager.on('message', (message) => __awaiter(this, void 0, void 0, function* () {
                    if (message.object.object)
                        message = message.object;
                    if (message.context)
                        context = message.context;
                    const payload = message.object;
                    yield bot.objects.resolveEmbeds(payload);
                    const type = payload[TYPE];
                    const model = models[type];
                    if (model.subClassOf === 'tradle.Form') {
                        yield relationshipManager.send({
                            other: { context },
                            object: buildResource({
                                models,
                                model: 'tradle.Verification'
                            })
                                .set({
                                [TYPE]: 'tradle.Verification',
                                document: payload,
                                dateVerified: Date.now()
                            })
                                .toJSON()
                        });
                    }
                    if (context) {
                        const application = yield this.getApplicationByContext({ context });
                        if (application.status === 'completed') {
                            yield this.approve({
                                user,
                                relationshipManager,
                                application,
                                context
                            });
                        }
                    }
                }));
            }
            const start = Date.now();
            const result = yield this.runThroughApplication({
                user,
                relationshipManager,
                product,
                awaitCertificate: true
            });
            const { application, conversation } = result;
            const storedConversation = yield this.bot.db.find({
                orderBy: {
                    property: 'time',
                    desc: false
                },
                filter: {
                    GT: {
                        time: start - 1
                    },
                    EQ: {
                        [TYPE]: 'tradle.Message',
                        _counterparty: user.permalink
                    }
                }
            });
            return result;
        });
        this.approve = function (opts) {
            opts.approve = true;
            return this.judge(opts);
        };
        this.reject = function (opts) {
            opts.approve = false;
            return this.judge(opts);
        };
        this.judge = ({ relationshipManager, user, application, context, approve = true }) => __awaiter(this, void 0, void 0, function* () {
            const { bot, productsAPI, models } = this;
            if (application) {
                context = application.context;
            }
            else {
                application = yield this.getApplicationByContext({ context });
            }
            const approval = buildResource({
                models,
                model: 'tradle.ApplicationApproval',
            })
                .set({
                application,
                message: 'approved!'
            })
                .toJSON();
            const denial = buildResource({
                models,
                model: 'tradle.ApplicationDenial',
            })
                .set({
                application,
                message: 'denied!'
            })
                .toJSON();
            const judgment = approve ? approval : denial;
            yield (relationshipManager || bot).send({
                object: judgment,
                other: { context }
            });
            yield wait(4000);
        });
        this.assignEmployee = ({ user, employee, context }) => __awaiter(this, void 0, void 0, function* () {
            const application = yield this.getApplicationByContext({ context });
            const { models } = this;
            const assign = employee.send({
                other: { context },
                object: buildResource({
                    models,
                    model: 'tradle.AssignRelationshipManager',
                    resource: {
                        employee: buildResource.stub({
                            models,
                            resource: employee.identity
                        }),
                        application: buildResource.stub({
                            models,
                            resource: application
                        })
                    }
                }).toJSON()
            });
            const getIntroduced = user.awaitMessage();
            yield Promise.all([getIntroduced, assign]);
        });
        this.runThroughApplication = ({ user, awaitCertificate, product, relationshipManager }) => __awaiter(this, void 0, void 0, function* () {
            const conversation = [];
            const { productsAPI, employeeManager, models } = this;
            user.sendSelfIntroduction();
            user.on('messages', messages => conversation.push(...messages));
            user.on('send', message => conversation.push(message));
            yield user.waitFor(message => {
                const { object } = message;
                return object[TYPE] === 'tradle.FormRequest' &&
                    object.form !== 'tradle.TermsAndConditions';
            });
            const bizModels = productsAPI.models.biz;
            user.send({ object: createProductRequest(product) });
            let assignedEmployee;
            let context;
            let stop;
            while (!stop) {
                let messages = yield user.awaitMessages();
                for (let message of messages) {
                    let { object } = message;
                    if (!context) {
                        context = message.context;
                    }
                    if (relationshipManager && !assignedEmployee) {
                        yield this.assignEmployee({ user, context, employee: relationshipManager });
                        assignedEmployee = true;
                    }
                    let type = object[TYPE];
                    if (type === 'tradle.FormRequest') {
                        let form = genSample({
                            models,
                            model: models[object.form]
                        })
                            .value;
                        user.send({
                            object: form,
                            other: { context }
                        });
                    }
                    else if (models[type].subClassOf === 'tradle.MyProduct') {
                        stop = true;
                    }
                    else if (!awaitCertificate) {
                        stop = true;
                    }
                }
            }
            return {
                application: yield this.getApplicationByContext({ context }),
                conversation
            };
            function createProductRequest(product) {
                return buildResource({
                    models,
                    model: 'tradle.ProductRequest',
                })
                    .set({
                    requestFor: product,
                    contextId: nodeCrypto.randomBytes(32).toString('hex')
                })
                    .toJSON();
            }
        });
        this.dumpDB = ({ types }) => __awaiter(this, void 0, void 0, function* () {
            const results = yield types.map(type => this.bot.db.search({ type }));
            types.forEach((type, i) => {
                console.log(type);
                console.log(JSON.stringify(results[i].items, null, 2));
            });
        });
        this.getApplicationByContext = ({ context }) => __awaiter(this, void 0, void 0, function* () {
            const { bot } = this;
            return yield bot.db.findOne({
                filter: {
                    EQ: {
                        [TYPE]: APPLICATION,
                        context
                    }
                }
            });
        });
        this.bot = bot;
        this.tradle = tradle;
        this.productsAPI = productsAPI;
        this.employeeManager = employeeManager;
        this.products = productsAPI.products.filter(p => p !== 'tradle.EmployeeOnboarding');
        this._ready = this._init();
        this.logger = bot.env.sublogger('e2e');
        this.debug = this.logger.debug;
    }
    get models() {
        return this.bot.modelStore.models;
    }
}
exports.Test = Test;
const createUser = ({ tradle, bot, name }) => __awaiter(this, void 0, void 0, function* () {
    const { identity, keys, profile } = yield genIdentity(tradle);
    return new User({
        tradle,
        identity,
        keys,
        bot,
        profile,
        name: name || profile.name.formatted
    });
});
exports.createUser = createUser;
class User extends EventEmitter {
    constructor({ tradle, identity, keys, profile, name, bot }) {
        super();
        this.awaitType = (type) => __awaiter(this, void 0, void 0, function* () {
            return this.waitFor(message => {
                return message.object[TYPE] === type;
            });
        });
        this.waitFor = (filter) => __awaiter(this, void 0, void 0, function* () {
            return new Promise(resolve => {
                const handler = (message) => {
                    if (filter(message)) {
                        this.removeListener('message', handler);
                        resolve();
                    }
                };
                this.on('message', handler);
            });
        });
        this.awaitMessages = function () {
            return new Promise(resolve => this.once('messages', resolve));
        };
        this.awaitMessage = function () {
            return new Promise(resolve => this.once('message', resolve));
        };
        this.sign = function (object) {
            return this.bot.sign(object, this);
        };
        this.send = ({ object, other }) => __awaiter(this, void 0, void 0, function* () {
            yield this._ready;
            this.debug('sending', object[TYPE]);
            const message = yield this._createMessage({ object, other });
            this.emit('send', message);
            yield onmessage.invoke({
                clientId: this.clientId,
                data: yield IotMessage.encode({
                    type: 'messages',
                    payload: [message].map(item => validateResource.utils.omitVirtualDeep(item))
                })
            });
        });
        this._createMessage = ({ object, other = {} }) => __awaiter(this, void 0, void 0, function* () {
            if (!object[SIG]) {
                object = yield this.sign(object);
            }
            const unsigned = _.extend({
                [TYPE]: 'tradle.Message',
                [SEQ]: this._userSeq++,
                time: Date.now(),
                recipientPubKey: this.botPubKey,
                object: utils.omitVirtual(object)
            }, other);
            const message = yield this.sign(unsigned);
            message.object = object;
            const replacements = replaceDataUrls({
                endpoint: this.tradle.aws.s3.endpoint.host,
                object,
                bucket: this.tradle.buckets.FileUpload.name,
                keyPrefix: `test-${this.permalink}`
            });
            if (replacements.length) {
                yield replacements.map(({ key, bucket, body, mimetype }) => {
                    return this.tradle.s3Utils.put({ key, bucket, value: body, headers: { ContentType: mimetype } });
                });
                this.debug('uploaded embedded media');
            }
            yield this.bot.save(object);
            return message;
        });
        this.sendSelfIntroduction = function () {
            const { models, identity, profile } = this;
            const selfIntro = buildResource({
                models,
                model: 'tradle.SelfIntroduction',
                resource: {
                    identity,
                    name: profile.name.formatted
                }
            })
                .toJSON();
            return this.send({ object: selfIntro });
        };
        this.tradle = tradle;
        this.env = tradle.env;
        this.logger = this.env.sublogger('e2e:user');
        this.debug = this.logger.debug;
        this.name = name;
        this.identity = identity;
        this.permalink = crypto.getPermalink(this.identity);
        this.clientId = this.permalink.repeat(2);
        this.keys = keys;
        this.profile = profile;
        this.bot = bot;
        this.userPubKey = tradleUtils.sigPubKey(this.identity);
        this.botPubKey = tradleUtils.sigPubKey(bot.identity);
        this._userSeq = 0;
        this._botSeq = 0;
        this.on('message', message => {
            const types = [];
            let payload = message;
            while (payload.object) {
                types.push(payload.object[TYPE]);
                payload = payload.object;
            }
            this.debug('received', types.join(' -> '));
            if (payload[TYPE] === 'tradle.FormRequest') {
                if (payload.form === 'tradle.TermsAndConditions') {
                    this.debug('accepting T&Cs');
                    this.send({
                        object: payload.prefill
                    });
                }
            }
        });
        tradle.delivery.mqtt.on('messages', ({ recipient, messages }) => {
            if (recipient === this.permalink) {
                this.emit('messages', messages);
            }
        });
        tradle.delivery.mqtt.on('message', ({ recipient, message }) => {
            if (recipient === this.permalink) {
                this.emit('message', message);
            }
        });
        this._types = [];
        recordTypes(this, this._types);
        this.debug('permalink', this.permalink);
        this._ready = tradle.identities.addContact(this.identity);
    }
    get models() {
        return this.bot.modelStore.models;
    }
}
function wait(millis) {
    return new Promise(resolve => setTimeout(resolve, millis));
}
function getPubKeyString(pub) {
    if (Array.isArray(pub)) {
        pub = new Buffer(pub);
    }
    return pub.toString('hex');
}
function recordTypes(user, types) {
    return function (message) {
        const type = message.object[TYPE];
        if (type !== 'tradle.Message' && !types.includes(type)) {
            types.push(type);
        }
    };
}
function wrapWithIntercept(fn) {
    return function (...args) {
        return __awaiter(this, void 0, void 0, function* () {
            const { bot, tradle } = this;
            this.interceptor = intercept({ bot, tradle });
            try {
                yield fn.apply(this, args);
            }
            finally {
                yield wait(2000);
                this.interceptor.restore();
            }
        });
    };
}
const clearBuckets = ({ tradle }) => __awaiter(this, void 0, void 0, function* () {
    yield Promise.all(Object.keys(tradle.buckets)
        .filter(id => {
        return id !== 'PublicConf' &&
            id !== 'PrivateConf' &&
            id !== 'Secrets' &&
            id !== 'Objects';
    })
        .map((id) => __awaiter(this, void 0, void 0, function* () {
        const bucket = tradle.buckets[id];
        try {
            yield bucket.clear();
        }
        catch (err) {
            Errors.ignore(err, {
                code: 'NoSuchBucket'
            });
        }
    })));
});
const clearTables = ({ tradle }) => __awaiter(this, void 0, void 0, function* () {
    const { debug } = tradle.logger;
    const clearTable = (TableName) => __awaiter(this, void 0, void 0, function* () {
        while (true) {
            try {
                yield tradle.dbUtils.clear(TableName);
                debug(`cleared table: ${TableName}`);
                break;
            }
            catch (err) {
                if (err.name === 'ResourceNotFoundException') {
                    break;
                }
                if (err.name !== 'LimitExceededException') {
                    throw err;
                }
                yield wait(1000);
            }
        }
    });
    const existingTables = yield tradle.dbUtils.listTables(tradle.env);
    const toDelete = existingTables.filter(name => {
        if (!name.startsWith(tradle.prefix)) {
            return false;
        }
        name = name.slice(tradle.prefix.length);
        return name !== 'pubkeys';
    });
    debug('clearing tables', toDelete);
    const batches = _.chunk(toDelete, 5);
    yield Promise.all(batches.map((batch) => __awaiter(this, void 0, void 0, function* () {
        yield Promise.all(batch.map(clearTable));
        debug('cleared tables', batch);
    })));
    debug('done clearing tables');
});
const clear = ({ tradle }) => __awaiter(this, void 0, void 0, function* () {
    yield Promise.all([
        clearTables({ tradle }),
        clearBuckets({ tradle })
    ]);
});
exports.clear = clear;
//# sourceMappingURL=end-to-end.js.map