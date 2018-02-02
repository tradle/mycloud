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
const Pack = require("@tradle/models-pack");
const constants_1 = require("@tradle/constants");
const dynamodb_1 = require("@tradle/dynamodb");
const cacheable_bucket_item_1 = require("./cacheable-bucket-item");
const Errors = require("./errors");
const constants_2 = require("./constants");
const utils_1 = require("./utils");
const parseJSON = obj => JSON.parse(obj);
const MODELS_PACK = 'tradle.ModelsPack';
const MODELS_PACK_CACHE_MAX_AGE = 60000;
const MINUTE = 60000;
const getDomain = pack => {
    if (typeof pack === 'object') {
        pack = Object.assign({}, pack, { [constants_1.TYPE]: MODELS_PACK });
    }
    return Pack.getDomain(pack);
};
const getNamespace = pack => {
    if (typeof pack === 'object') {
        pack = Object.assign({}, pack, { [constants_1.TYPE]: MODELS_PACK });
    }
    return Pack.getNamespace(pack);
};
class ModelStore extends events_1.EventEmitter {
    constructor(tradle) {
        super();
        this.get = (id) => __awaiter(this, void 0, void 0, function* () {
            const namespace = Pack.getNamespace(id);
            let model = this.cache.models[id];
            if (!model) {
                yield this.onMissingModel(id);
                model = this.cache.models[id];
            }
            if (!model) {
                throw new Errors.NotFound(`model with id: ${id}`);
            }
            return model;
        });
        this.addModelsPack = ({ modelsPack, validateAuthor = true, validateUpdate = true, key }) => __awaiter(this, void 0, void 0, function* () {
            if (validateAuthor) {
                yield this.validateModelsPackNamespaceOwner(modelsPack);
            }
            if (validateUpdate) {
                yield this.validateModelsPackUpdate(modelsPack);
            }
            const current = yield this.getCumulativeModelsPack();
            let cumulative;
            if (current) {
                cumulative = omitNamespace({
                    modelsPack: current,
                    namespace: modelsPack.namespace
                });
                extendModelsPack(cumulative, modelsPack);
            }
            else {
                cumulative = _.omit(modelsPack, ['namespace']);
            }
            this.logger.debug(`added ${modelsPack.namespace} models pack`);
            if (!key)
                key = exports.getModelsPackConfKey(modelsPack);
            yield Promise.all([
                this.bucket.gzipAndPut(key, modelsPack),
                this.bucket.gzipAndPut(this.cumulativePackKey, cumulative),
            ]);
            this.emit('update:cumulative', cumulative);
            return cumulative;
        });
        this.updateGraphqlSchema = (opts = {}) => __awaiter(this, void 0, void 0, function* () {
            let { cumulativeModelsPack } = opts;
            if (!cumulativeModelsPack)
                cumulativeModelsPack = yield this.getCumulativeModelsPack();
            const models = getCumulative(this, cumulativeModelsPack, false);
            const { exportSchema } = require('./bot/graphql');
            const schema = exportSchema({ models });
            yield this.bucket.gzipAndPut(this.cumulativeGraphqlSchemaKey, schema);
        });
        this.loadModelsPacks = () => __awaiter(this, void 0, void 0, function* () {
            const cumulative = yield this.getCumulativeModelsPack();
            if (cumulative) {
                this.logger.debug('loaded cumulative models pack');
                this.emit('update:cumulative', cumulative);
            }
        });
        this.getCumulativeModelsPack = (opts) => __awaiter(this, void 0, void 0, function* () {
            try {
                return yield this.cumulativePackItem.get(opts);
            }
            catch (err) {
                Errors.ignore(err, Errors.NotFound);
                return null;
            }
        });
        this.getSavedGraphqlSchema = () => __awaiter(this, void 0, void 0, function* () {
            const schema = yield this.bucket.getJSON(this.cumulativeGraphqlSchemaKey);
            return require('./bot/graphql').importSchema(schema);
        });
        this.getGraphqlSchema = () => __awaiter(this, void 0, void 0, function* () {
            try {
                return yield this.getSavedGraphqlSchema();
            }
            catch (err) {
                Errors.ignore(err, Errors.NotFound);
                return require('./bot/graphql').exportSchema({
                    models: this.models
                });
            }
        });
        this.getModelsForNamespace = (namespace) => {
            const prefix = namespace + '.';
            const models = _.filter(this.models, (value, key) => key.startsWith(prefix));
            return Pack.pack({ namespace, models });
        };
        this.saveCustomModels = ({ modelsPack, key }) => __awaiter(this, void 0, void 0, function* () {
            modelsPack = Pack.pack(modelsPack);
            const { namespace, models, lenses } = modelsPack;
            if (namespace) {
                this.setMyNamespace(namespace);
            }
            this.setCustomModels(modelsPack);
            yield this.addModelsPack({
                validateAuthor: false,
                modelsPack: this.myModelsPack,
                key
            });
        });
        this.setCustomModels = (modelsPack) => {
            modelsPack = Pack.pack(modelsPack);
            const { namespace = getNamespace(modelsPack), models = [], lenses = [] } = modelsPack;
            if (!namespace) {
                throw new Error('expected "namespace"');
            }
            this.cache.removeModels(this.myCustomModels);
            this.addModels(models);
            this.myModelsPack = modelsPack;
            this.myNamespace = namespace;
            this.myCustomModels = _.clone(models);
        };
        this.setMyNamespace = (namespace) => {
            this.myNamespace = namespace;
            this.myDomain = exports.toggleDomainVsNamespace(namespace);
        };
        this.setMyDomain = (domain) => {
            this.myDomain = domain;
            this.myNamespace = exports.toggleDomainVsNamespace(domain);
        };
        this.addModel = model => this.cache.addModel(model);
        this.addModels = models => this.cache.addModels(models);
        this.getModelsPackByDomain = (domain) => __awaiter(this, void 0, void 0, function* () {
            return yield this.bucket.getJSON(exports.getModelsPackConfKey(domain));
        });
        this.validateModelsPackNamespaceOwner = (pack) => __awaiter(this, void 0, void 0, function* () {
            if (!pack.namespace) {
                throw new Error(`ignoring ModelsPack sent by ${pack._author}, as it isn't namespaced`);
            }
            const domain = getDomain(pack);
            const friend = yield this.tradle.friends.getByDomain(domain);
            if (!pack._author) {
                yield this.tradle.identities.addAuthorInfo(pack);
            }
            if (friend._identityPermalink !== pack._author) {
                throw new Error(`ignoring ModelsPack sent by ${pack._author}.
Domain ${domain} (and namespace ${pack.namespace}) belongs to ${friend._identityPermalink}`);
            }
        });
        this.validateModelsPackUpdate = (pack) => __awaiter(this, void 0, void 0, function* () {
            const ret = {
                changed: true
            };
            const domain = getDomain(pack);
            try {
                const current = yield this.getModelsPackByDomain(domain);
                exports.validateUpdate(current, pack);
                ret.changed = current.versionId !== pack.versionId;
            }
            catch (err) {
                Errors.ignore(err, Errors.NotFound);
            }
            return ret;
        });
        this.validateModelsPack = (modelsPack) => __awaiter(this, void 0, void 0, function* () {
            yield this.validateModelsPackNamespaceOwner(modelsPack);
            return yield this.validateModelsPackUpdate(modelsPack);
        });
        this.getModelsPackConfKey = exports.getModelsPackConfKey;
        this.onMissingModel = (id) => __awaiter(this, void 0, void 0, function* () {
            const modelsPack = yield this.getModelsPackByDomain(getDomain(id));
            this.cache.addModels(modelsPack.models);
        });
        this.tradle = tradle;
        this.logger = tradle.logger.sub('modelstore');
        this.baseModels = tradle.models;
        this.baseModelsIds = Object.keys(this.baseModels);
        this.myCustomModels = {};
        this.cache = dynamodb_1.createModelStore({
            models: this.baseModels,
            onMissingModel: this.onMissingModel.bind(this)
        });
        this.cache.on('update', () => this.emit('update'));
        this.bucket = this.tradle.buckets.PrivateConf;
        this.cumulativePackKey = constants_2.PRIVATE_CONF_BUCKET.modelsPack;
        this.cumulativeGraphqlSchemaKey = constants_2.PRIVATE_CONF_BUCKET.graphqlSchema;
        this.cumulativePackItem = new cacheable_bucket_item_1.CacheableBucketItem({
            bucket: this.bucket,
            key: this.cumulativePackKey,
            ttl: 5 * MINUTE,
            parse: parseJSON
        });
        this.cumulativeGraphqlSchemaItem = new cacheable_bucket_item_1.CacheableBucketItem({
            bucket: this.bucket,
            key: this.cumulativeGraphqlSchemaKey,
            ttl: 5 * MINUTE,
            parse: parseJSON
        });
        this.on('update:cumulative', pack => {
            this.cumulativeModelsPack = pack;
            this.addModels(pack.models);
        });
    }
    get models() {
        return this.cache.models;
    }
    getMyCustomModels() {
        return _.clone(this.myCustomModels);
    }
}
exports.ModelStore = ModelStore;
exports.getModelsPackConfKey = domainOrPack => {
    if (typeof domainOrPack === 'string') {
        return `${constants_2.PRIVATE_CONF_BUCKET.assetsFolder}/${domainOrPack}/models-pack.json`;
    }
    if (domainOrPack[constants_1.TYPE] === MODELS_PACK) {
        return exports.getModelsPackConfKey(getDomain(domainOrPack));
    }
    throw new Error('expected domain or ModelsPack');
};
exports.createModelStore = (tradle) => new ModelStore(tradle);
exports.toggleDomainVsNamespace = str => str.split('.').reverse().join('.');
exports.validateUpdate = (current, updated) => {
    const lost = _.difference(current, Object.keys(updated));
    if (lost.length) {
        throw new Error(`models cannot be removed, only deprecated: ${lost.join(', ')}`);
    }
};
const getCumulative = (modelStore, foreign, customOnly) => {
    const domestic = customOnly ? modelStore.getMyCustomModels() : modelStore.models;
    return Object.assign({}, utils_1.toModelsMap(_.get(foreign, 'models', [])), domestic);
};
const omitNamespace = ({ modelsPack, namespace }) => {
    let { models = [], lenses = [] } = modelsPack;
    models = models
        .filter(model => Pack.getNamespace(model.id) !== namespace);
    lenses = lenses
        .filter(lens => Pack.getNamespace(lens.id) !== namespace);
    return Pack.pack({ models, lenses });
};
const extendModelsPack = (modelsPack, ...sourcePacks) => {
    sourcePacks.forEach(source => {
        const models = (modelsPack.models || []).concat(source.models || []);
        const lenses = (modelsPack.lenses || []).concat(source.lenses || []);
        modelsPack.models = _.uniqBy(models, 'id');
        modelsPack.lenses = _.uniqBy(lenses, 'id');
    });
    return modelsPack;
};
//# sourceMappingURL=model-store.js.map