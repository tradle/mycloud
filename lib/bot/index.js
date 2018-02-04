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
const events_1 = require("events");
const _ = require("lodash");
const Promise = require("bluebird");
const createHooks = require("event-hooks");
const buildResource = require("@tradle/build-resource");
const validateResource = require("@tradle/validate-resource");
const ready_mixin_1 = require("./ready-mixin");
const crypto_1 = require("../crypto");
const utils_1 = require("./utils");
const constants = require("../constants");
const createUsers = require("./users");
const lambda_1 = require("./lambda");
const locker_1 = require("./locker");
const { TYPE, SIG } = constants;
const { parseStub } = validateResource.utils;
const promisePassThrough = data => Promise.resolve(data);
const PROXY_TO_TRADLE = [
    'aws', 'objects', 'db', 'dbUtils', 'contentAddressedStore',
    'lambdaUtils', 'iot', 'seals', 'modelStore',
    'identities', 'history', 'messages', 'friends',
    'resources', 'env', 'router', 'buckets', 'tables',
    'serviceMap', 'version', 'apiBaseUrl', 'tasks'
];
exports.createBot = (opts = {}) => {
    return new Bot(Object.assign({}, opts, { tradle: opts.tradle || require('../').tradle }));
};
const lambdaCreators = {
    get onmessage() { return require('./lambda/onmessage'); },
    get onmessagestream() { return require('./lambda/onmessagestream'); },
    get onsealstream() { return require('./lambda/onsealstream'); },
    get oninit() { return require('./lambda/oninit'); },
    get onsubscribe() { return require('./lambda/onsubscribe'); },
    get onconnect() { return require('./lambda/onconnect'); },
    get ondisconnect() { return require('./lambda/ondisconnect'); },
    get sealpending() { return require('./lambda/sealpending'); },
    get pollchain() { return require('./lambda/pollchain'); },
    get checkFailedSeals() { return require('./lambda/check-failed-seals'); },
    get toevents() { return require('./lambda/to-events'); },
    get info() { return require('./lambda/info'); },
    get preauth() { return require('./lambda/preauth'); },
    get auth() { return require('./lambda/auth'); },
    get inbox() { return require('./lambda/inbox'); },
    get warmup() { return require('./lambda/warmup'); },
    get reinitializeContainers() { return require('./lambda/reinitialize-containers'); },
};
class Bot extends events_1.EventEmitter {
    constructor(opts) {
        super();
        this.onmessage = handler => this.hooks.hook('message', handler);
        this.oninit = handler => this.hooks.hook('init', handler);
        this.onseal = handler => this.hooks.hook('seal', handler);
        this.onreadseal = handler => this.hooks.hook('readseal', handler);
        this.onwroteseal = handler => this.hooks.hook('wroteseal', handler);
        this.send = (opts) => __awaiter(this, void 0, void 0, function* () {
            const batch = yield Promise.all([].concat(opts)
                .map(oneOpts => utils_1.normalizeSendOpts(this, oneOpts)));
            const byRecipient = _.groupBy(batch, 'recipient');
            const recipients = Object.keys(byRecipient);
            this.logger.debug(`queueing messages to ${recipients.length} recipients`, {
                recipients
            });
            const results = yield Promise.all(recipients.map((recipient) => __awaiter(this, void 0, void 0, function* () {
                const subBatch = byRecipient[recipient];
                const types = subBatch.map(m => m[TYPE]).join(', ');
                this.logger.debug(`sending to ${recipient}: ${types}`);
                yield this.outboundMessageLocker.lock(recipient);
                let messages;
                try {
                    messages = yield this.provider.sendMessageBatch(subBatch);
                    this.tasks.add({
                        name: 'delivery:live',
                        promiser: () => this.provider.attemptLiveDelivery({
                            recipient,
                            messages
                        })
                    });
                }
                finally {
                    this.outboundMessageLocker.unlock(recipient);
                }
                return messages;
            })));
            const messages = _.flatten(results);
            if (messages) {
                return Array.isArray(opts) ? messages : messages[0];
            }
        });
        this.setCustomModels = pack => this.modelStore.setCustomModels(pack);
        this.init = opts => this.tradle.init.init(opts);
        this.getMyIdentity = () => this.tradle.provider.getMyPublicIdentity();
        this.getMyIdentityPermalink = () => this.tradle.provider.getMyIdentityPermalink();
        this.sign = (object, author) => this.tradle.provider.signObject({ object, author });
        this.seal = opts => this.seals.create(opts);
        this.forceReinitializeContainers = (functions) => __awaiter(this, void 0, void 0, function* () {
            if (this.isTesting)
                return;
            yield this.lambdaUtils.invoke({
                name: 'reinitialize-containers',
                sync: false,
                arg: functions
            });
        });
        this.save = createWriteMethod('put');
        this.update = createWriteMethod('update');
        this.createLambda = (opts = {}) => lambda_1.createLambda(Object.assign({}, opts, { tradle: this.tradle, bot: this }));
        this.getResource = ({ type, permalink }) => __awaiter(this, void 0, void 0, function* () {
            return yield this.db.get({
                [TYPE]: type,
                _permalink: permalink
            });
        });
        this.getResourceByStub = (stub) => __awaiter(this, void 0, void 0, function* () {
            return yield this.getResource(parseStub(stub));
        });
        this.resolveEmbeds = object => this.objects.resolveEmbeds(object);
        this.presignEmbeddedMediaLinks = object => this.objects.presignEmbeddedMediaLinks(object);
        this.createNewVersion = (resource) => __awaiter(this, void 0, void 0, function* () {
            const latest = buildResource.version(resource);
            const signed = yield this.sign(latest);
            crypto_1.addLinks(signed);
            return signed;
        });
        this.signAndSave = (resource) => __awaiter(this, void 0, void 0, function* () {
            const signed = yield this.sign(resource);
            crypto_1.addLinks(signed);
            yield this.save(signed);
            return signed;
        });
        this.versionAndSave = (resource) => __awaiter(this, void 0, void 0, function* () {
            const newVersion = yield this.createNewVersion(resource);
            yield this.save(newVersion);
            return newVersion;
        });
        this.reSign = object => this.sign(_.omit(object, [SIG]));
        let { tradle, users, ready = true } = opts;
        const { env, logger, tables } = tradle;
        this.tradle = tradle;
        this.users = users || createUsers({
            table: tradle.tables.Users,
            oncreate: user => this.hooks.fire('usercreate', user)
        });
        this.logger = logger.sub('bot');
        this.debug = this.logger.debug;
        const MESSAGE_LOCK_TIMEOUT = this.isTesting ? null : 10000;
        this.outboundMessageLocker = locker_1.createLocker({
            name: 'message send lock',
            debug: logger.sub('message-locker:send').debug,
            timeout: MESSAGE_LOCK_TIMEOUT
        });
        ready_mixin_1.readyMixin(this);
        this.kv = tradle.kv.sub('bot:kv:');
        this.conf = tradle.kv.sub('bot:conf:');
        this.endpointInfo = {
            aws: true,
            iotParentTopic: env.IOT_PARENT_TOPIC,
            version: this.version
        };
        this.hooks = createHooks();
        this.hook = this.hooks.hook;
        this.lambdas = Object.keys(lambdaCreators).reduce((map, name) => {
            map[name] = opts => lambdaCreators[name].createLambda(Object.assign({}, opts, { tradle, bot: this }));
            return map;
        }, {});
        if (this.isTesting) {
            this.trigger = (event, ...args) => this.hooks.fire(event, ...args);
        }
        if (ready)
            this.ready();
    }
    get aws() { return this.tradle.aws; }
    get objects() { return this.tradle.objects; }
    get db() { return this.tradle.db; }
    get dbUtils() { return this.tradle.dbUtils; }
    get contentAddressedStore() { return this.tradle.contentAddressedStore; }
    get lambdaUtils() { return this.tradle.lambdaUtils; }
    get iot() { return this.tradle.iot; }
    get seals() { return this.tradle.seals; }
    get modelStore() { return this.tradle.modelStore; }
    get identities() { return this.tradle.identities; }
    get addressBook() { return this.tradle.identities; }
    get messages() { return this.tradle.messages; }
    get friends() { return this.tradle.friends; }
    get env() { return this.tradle.env; }
    get buckets() { return this.tradle.buckets; }
    get tables() { return this.tradle.tables; }
    get serviceMap() { return this.tradle.serviceMap; }
    get version() { return this.tradle.version; }
    get apiBaseUrl() { return this.tradle.apiBaseUrl; }
    get tasks() { return this.tradle.tasks; }
    get isTesting() { return this.tradle.env.TESTING; }
    get models() { return this.modelStore.models; }
    get middleware() {
        return {
            get graphql() {
                return {
                    queryHandler: require('./middleware/graphql').createHandler,
                    auth: require('./middleware/graphql-auth').createHandler
                };
            }
        };
    }
    get provider() { return this.tradle.provider; }
}
exports.Bot = Bot;
const createWriteMethod = (method) => function (resource) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!this.isReady()) {
            this.logger.debug('waiting for this.ready()');
            yield this.promiseReady();
        }
        try {
            yield this.provider.putPayload({
                payload: resource,
                merge: method === 'update'
            });
        }
        catch (err) {
            this.logger.debug(`db.${method} failed`, {
                type: resource[TYPE],
                link: resource._link,
                input: err.input,
                error: err.stack
            });
        }
        return resource;
    });
};
//# sourceMappingURL=index.js.map