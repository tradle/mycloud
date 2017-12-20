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
const Promise = require("bluebird");
const mergeModels = require("@tradle/merge-models");
const createHooks = require("event-hooks");
const BaseModels = require("../models");
const ready_mixin_1 = require("./ready-mixin");
const utils_1 = require("../utils");
const utils_2 = require("./utils");
const constants = require("../constants");
const createUsers = require("./users");
const lambda_1 = require("./lambda");
const locker_1 = require("./locker");
const convenience_1 = require("./convenience");
const { TYPE, SIG } = constants;
const promisePassThrough = data => Promise.resolve(data);
const PROXY_TO_TRADLE = [
    'aws', 'objects', 'db', 'dbUtils', 'contentAddressedStore',
    'lambdaUtils', 'iot', 'seals',
    'identities', 'history', 'messages', 'friends',
    'resources', 'env', 'router', 'buckets', 'tables',
    'serviceMap', 'version', 'apiBaseUrl', 'tasks'
];
const HOOKABLE = [
    { name: 'init' },
    { name: 'message' },
    { name: 'seal' },
    { name: 'readseal' },
    { name: 'wroteseal' },
    { name: 'usercreate' },
    { name: 'useronline' },
    { name: 'useroffline' },
    { name: 'messagestream' },
    { name: 'info' }
];
exports.createBot = (opts = {}) => {
    return _createBot(Object.assign({}, opts, { tradle: opts.tradle || require('../').tradle }));
};
function _createBot(opts) {
    let { tradle, users, models, autosave = true } = opts;
    const { env, } = tradle;
    const { TESTING, FUNCTION_NAME } = env;
    const logger = env.sublogger('bot-engine');
    const MESSAGE_LOCK_TIMEOUT = TESTING ? null : 10000;
    const bot = new events_1.EventEmitter();
    PROXY_TO_TRADLE.forEach(prop => {
        utils_1.defineGetter(bot, prop, () => tradle[prop]);
    });
    ready_mixin_1.readyMixin(bot);
    bot.on('ready', () => bot.debug('ready!'));
    utils_1.defineGetter(bot, 'conf', () => tradle.conf.sub(':bot'));
    utils_1.defineGetter(bot, 'kv', () => tradle.kv.sub(':bot'));
    utils_1.defineGetter(bot, 'models', () => models);
    bot.isTesting = TESTING;
    bot.init = () => tradle.init.init(opts);
    bot.getMyIdentity = () => tradle.provider.getMyPublicIdentity();
    bot.sign = (object, author) => tradle.provider.signObject({ object, author });
    bot.seal = ({ link, permalink }) => __awaiter(this, void 0, void 0, function* () {
        const chainKey = yield tradle.provider.getMyChainKey();
        yield bot.seals.create({
            link,
            permalink,
            key: chainKey
        });
    });
    bot.setCustomModels = customModels => {
        const merger = mergeModels()
            .add(BaseModels, { validate: false })
            .add(customModels, { validate: env.TESTING });
        models = merger.get();
        bot.db.addModels(merger.rest());
        bot.emit('models', models);
    };
    if (models) {
        bot.setCustomModels(models);
    }
    bot.forceReinitializeContainers = (functions) => __awaiter(this, void 0, void 0, function* () {
        if (env.TESTING)
            return;
        yield bot.lambdaUtils.invoke({
            name: 'reinitialize-containers',
            sync: false,
            arg: functions
        });
    });
    bot.logger = logger.sub('bot');
    bot.debug = logger.debug;
    bot.endpointInfo = {
        aws: true,
        iotParentTopic: env.IOT_PARENT_TOPIC,
        version: bot.version
    };
    utils_1.defineGetter(bot, 'users', () => {
        if (!users) {
            users = createUsers({
                table: tradle.tables.Users,
                oncreate: user => hooks.fire('usercreate', user)
            });
        }
        return users;
    });
    const createWriteMethod = method => (resource) => __awaiter(this, void 0, void 0, function* () {
        if (!bot.isReady()) {
            logger.debug('waiting for bot.ready()');
            yield bot.promiseReady();
        }
        resource = utils_1.deepClone(resource);
        yield bot.objects.replaceEmbeds(resource);
        yield bot.db[method](utils_1.ensureTimestamped(resource));
        return resource;
    });
    bot.save = createWriteMethod('put');
    bot.update = createWriteMethod('update');
    bot.send = (opts) => __awaiter(this, void 0, void 0, function* () {
        const batch = yield Promise.all([].concat(opts)
            .map(oneOpts => utils_2.normalizeSendOpts(bot, oneOpts)));
        const byRecipient = utils_1.groupBy(batch, 'recipient');
        const recipients = Object.keys(byRecipient);
        logger.debug(`queueing messages to ${recipients.length} recipients`, { recipients });
        const results = yield Promise.all(recipients.map((recipient) => __awaiter(this, void 0, void 0, function* () {
            const subBatch = byRecipient[recipient];
            yield outboundMessageLocker.lock(recipient);
            let messages;
            try {
                messages = yield tradle.provider.sendMessageBatch(subBatch);
                bot.tasks.add({
                    name: 'delivery:live',
                    promiser: () => tradle.provider.attemptLiveDelivery({
                        recipient,
                        messages
                    })
                });
            }
            finally {
                outboundMessageLocker.unlock(recipient);
            }
            if (TESTING && messages) {
                yield Promise.all(messages.map(message => {
                    return utils_2.savePayloadToDB({ bot, message: utils_1.deepClone(message) });
                }));
            }
            return messages;
        })));
        const messages = utils_1.flatten(results);
        if (messages) {
            return Array.isArray(opts) ? messages : messages[0];
        }
    });
    const hooks = createHooks();
    bot.hooks = hooks;
    bot.hook = hooks.hook;
    const outboundMessageLocker = locker_1.createLocker({
        name: 'message send lock',
        debug: env.sublogger('message-locker:send').debug,
        timeout: MESSAGE_LOCK_TIMEOUT
    });
    bot.use = (strategy, opts) => strategy(bot, opts);
    bot.createLambda = (opts = {}) => lambda_1.createLambda(Object.assign({}, opts, { tradle,
        bot }));
    const lambdaCreators = {
        get onmessage() { return require('./lambda/onmessage'); },
        get onmessagestream() { return require('./lambda/onmessagestream'); },
        get onsealstream() { return require('./lambda/onsealstream'); },
        get oninit() { return require('./lambda/oninit'); },
        get info() { return require('./lambda/info'); },
        get preauth() { return require('./lambda/preauth'); },
        get auth() { return require('./lambda/auth'); },
        get inbox() { return require('./lambda/inbox'); },
        get graphql() { return require('./lambda/graphql'); }
    };
    bot.lambdas = Object.keys(lambdaCreators).reduce((map, name) => {
        map[name] = opts => lambdaCreators[name].createLambda(Object.assign({}, opts, { tradle, bot }));
        return map;
    }, {});
    HOOKABLE.forEach(({ name }) => {
        bot[`on${name}`] = fn => hooks.hook(name, fn);
    });
    if (TESTING) {
        bot.trigger = (event, ...args) => hooks.fire(event, ...args);
    }
    utils_1.defineGetter(bot, 'addressBook', () => bot.identities);
    convenience_1.default(bot);
    return bot;
    function emitAs(event) {
        return function (...args) {
            bot.emit(event, ...args);
        };
    }
}
//# sourceMappingURL=index.js.map