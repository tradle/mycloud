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
const ModelsPack = require("@tradle/models-pack");
const constants_1 = require("@tradle/constants");
const dynamodb_1 = require("@tradle/dynamodb");
const Errors = require("./errors");
const constants_2 = require("./constants");
const CUMULATIVE_PACK_KEY = constants_2.PRIVATE_CONF_BUCKET.modelsPack;
const CUMULATIVE_GRAPHQL_SCHEMA_KEY = constants_2.PRIVATE_CONF_BUCKET.graphqlSchema;
const MODELS_PACK = 'tradle.ModelsPack';
const MODELS_PACK_CACHE_MAX_AGE = 60000;
const MODELS_FOLDER = 'models';
const BUILT_IN_NAMESPACES = [
    'tradle',
    'io.tradle'
];
const firstValue = obj => {
    for (let key in obj)
        return obj[key];
};
class ModelStore extends events_1.EventEmitter {
    constructor(tradle) {
        super();
        this.get = (id) => __awaiter(this, void 0, void 0, function* () {
            if (BUILT_IN_NAMESPACES.includes(ModelsPack.getNamespace(id))) {
                return this.cache.models[id];
            }
            return yield this.cache.get(id);
        });
        this.updateCumulativeForeignModelsWithModelsPack = ({ modelsPack }) => __awaiter(this, void 0, void 0, function* () {
            yield this.validateInboundModelsPack(modelsPack);
            const current = yield this.getCumulativeForeignModelsPack();
            let cumulative;
            if (current) {
                const { namespace } = modelsPack;
                const models = current.models
                    .filter(model => ModelsPack.getNamespace(model) !== namespace)
                    .concat(modelsPack.models);
                cumulative = ModelsPack.pack({ models });
            }
            else {
                cumulative = modelsPack;
            }
            yield this.bucket.gzipAndPut(this.cumulativePackKey, cumulative);
            return cumulative;
        });
        this.addModelsPack = ({ modelsPack }) => __awaiter(this, void 0, void 0, function* () {
            const foreign = yield this.updateCumulativeForeignModelsWithModelsPack({ modelsPack });
            const models = getCumulative(this, foreign, false);
            const { exportSchema } = require('./bot/graphql');
            const schema = exportSchema({ models });
            yield this.bucket.gzipAndPut(this.cumulativeGraphqlSchemaKey, schema);
        });
        this.getCumulativeForeignModelsPack = () => __awaiter(this, void 0, void 0, function* () {
            try {
                return yield this.bucket.getJSON(this.cumulativePackKey);
            }
            catch (err) {
                Errors.ignore(err, Errors.NotFound);
                return null;
            }
        });
        this.getCumulativeModelsPack = () => __awaiter(this, void 0, void 0, function* () {
            const foreign = yield this.getCumulativeForeignModelsPack();
            return ModelsPack.pack({
                models: getCumulative(this, foreign, true)
            });
        });
        this.getSavedGraphqlSchema = () => __awaiter(this, void 0, void 0, function* () {
            return yield this.bucket.getJSON(this.cumulativeGraphqlSchemaKey);
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
            return ModelsPack.pack({ namespace, models });
        };
        this.setMyCustomModels = (models) => {
            const first = firstValue(models);
            if (!first)
                return;
            this.setMyNamespace(ModelsPack.getNamespace(first));
            this.cache.removeModels(this._myCustomModels);
            this.addModels(models);
            this._myCustomModels = _.clone(models);
        };
        this.setMyNamespace = (namespace) => {
            this.myNamespace = namespace;
            this.myDomain = namespace.split('.').reverse().join('.');
        };
        this.setMyDomain = (domain) => {
            this.myDomain = domain;
            this.myNamespace = domain.split('.').reverse().join('.');
        };
        this.buildMyModelsPack = () => {
            const models = this.getMyCustomModels();
            const namespace = this.myNamespace || ModelsPack.getNamespace(_.values(models));
            return ModelsPack.pack({ namespace, models });
        };
        this.addModels = (models) => {
            this.cache.addModels(models);
        };
        this.getModelsPackByDomain = (domain) => __awaiter(this, void 0, void 0, function* () {
            return yield this.bucket.getJSON(getModelsPackConfKey(domain));
        });
        this.validateInboundModelsPack = (pack) => __awaiter(this, void 0, void 0, function* () {
            if (!pack.namespace) {
                throw new Error(`ignoring ModelsPack sent by ${pack._author}, as it isn't namespaced`);
            }
            const domain = ModelsPack.getDomain(pack);
            const friend = yield this.tradle.friends.getByDomain(domain);
            if (!pack._author) {
                yield this.tradle.identities.addAuthorInfo(pack);
            }
            if (friend._identityPermalink !== pack._author) {
                throw new Error(`ignoring ModelsPack sent by ${pack._author}.
Domain ${domain} belongs to ${friend._identityPermalink}`);
            }
        });
        this.saveModelsPack = ({ modelsPack }) => __awaiter(this, void 0, void 0, function* () {
            yield this.validateInboundModelsPack(modelsPack);
            yield this.bucket.gzipAndPut(getModelsPackConfKey(modelsPack), modelsPack);
        });
        this.onMissingModel = (id) => __awaiter(this, void 0, void 0, function* () {
            const modelsPack = yield this.getModelsPackByDomain(ModelsPack.getDomain(id));
            this.cache.addModels(modelsPack.models);
        });
        this.tradle = tradle;
        this.logger = tradle.logger.sub('modelstore');
        this.baseModels = tradle.models;
        this._myCustomModels = {};
        this.cache = dynamodb_1.createModelStore({
            models: this.baseModels,
            onMissingModel: this.onMissingModel.bind(this)
        });
        this.cache.on('update', () => this.emit('update'));
        this.cumulativePackKey = CUMULATIVE_PACK_KEY;
        this.cumulativeGraphqlSchemaKey = CUMULATIVE_GRAPHQL_SCHEMA_KEY;
    }
    get bucket() {
        return this.tradle.buckets.PrivateConf;
    }
    get models() {
        return this.cache.models;
    }
    getAllCustomModels() {
        return _.omit(this.models, this.baseModels);
    }
    getMyCustomModels() {
        return _.clone(this._myCustomModels);
    }
}
exports.ModelStore = ModelStore;
const getModelsPackConfKey = domainOrPack => {
    if (typeof domainOrPack === 'string') {
        return `${MODELS_FOLDER}/${domainOrPack}/pack.json`;
    }
    if (domainOrPack[constants_1.TYPE] === MODELS_PACK) {
        return getModelsPackConfKey(ModelsPack.getDomain(domainOrPack));
    }
    throw new Error('expected domain or ModelsPack');
};
exports.createModelStore = (tradle) => new ModelStore(tradle);
const getCumulative = (modelStore, foreign, customOnly) => {
    const domestic = customOnly ? modelStore.getMyCustomModels() : modelStore.models;
    return Object.assign({}, toModelsMap(_.get(foreign, 'models', [])), domestic);
};
const toModelsMap = models => _.transform(models, (result, model) => {
    result[model.id] = model;
}, {});
//# sourceMappingURL=model-store.js.map