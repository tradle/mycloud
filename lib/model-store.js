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
const MODELS_PACK = 'tradle.ModelsPack';
const MODELS_PACK_CACHE_MAX_AGE = 60000;
const BUILT_IN_NAMESPACES = [
    'tradle',
    'io.tradle'
];
class ModelStore extends events_1.EventEmitter {
    constructor(tradle) {
        super();
        this.get = (id) => __awaiter(this, void 0, void 0, function* () {
            if (BUILT_IN_NAMESPACES.includes(ModelsPack.getNamespace(id))) {
                return this.store.models[id];
            }
            return yield this.store.get(id);
        });
        this.getModelsForNamespace = (namespace) => {
            const prefix = namespace + '.';
            const models = _.filter(this.models, (value, key) => key.startsWith(prefix));
            return ModelsPack.pack(models);
        };
        this.setMyCustomModels = (models) => {
            this.store.removeModels(this._myCustomModels);
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
        this.buildMyModelsPack = () => ModelsPack.pack(this.myCustomModels);
        this.addModels = (models) => {
            this.store.addModels(models);
        };
        this.getModelsPackByDomain = (domain) => __awaiter(this, void 0, void 0, function* () {
            return yield this.tradle.buckets.PrivateConf.getJSON(getModelsPackConfKey(domain));
        });
        this.saveModelsPack = (pack) => __awaiter(this, void 0, void 0, function* () {
            const domain = ModelsPack.getDomain(pack);
            const friend = yield this.tradle.friends.getByDomain(domain);
            if (!pack._author) {
                yield this.tradle.identities.addAuthorInfo(pack);
            }
            if (friend._identityPermalink !== pack._author) {
                throw new Error(`ignoring ModelsPack sent by ${pack._author}.
Domain ${domain} belongs to ${friend._identityPermalink}`);
            }
            yield this.tradle.buckets.PrivateConf.putJSON(getModelsPackConfKey(pack), pack);
        });
        this.onMissingModel = (id) => __awaiter(this, void 0, void 0, function* () {
            const modelsPack = yield this.getModelsPackByDomain(ModelsPack.getDomain(id));
            this.store.addModels(modelsPack.models);
        });
        this.tradle = tradle;
        this.baseModels = tradle.models;
        this._myCustomModels = {};
        this.store = dynamodb_1.createModelStore({
            models: this.baseModels,
            onMissingModel: this.onMissingModel.bind(this)
        });
        this.store.on('update', () => this.emit('update'));
    }
    get models() {
        return this.store.models;
    }
    get allCustomModels() {
        return _.omit(this.models, this.baseModels);
    }
    get myCustomModels() {
        return _.clone(this._myCustomModels);
    }
}
exports.ModelStore = ModelStore;
const getModelsPackConfKey = domainOrPack => {
    if (typeof domainOrPack === 'string') {
        return `models/${domainOrPack}/pack.json`;
    }
    if (domainOrPack[constants_1.TYPE] === MODELS_PACK) {
        return getModelsPackConfKey(ModelsPack.getDomain(domainOrPack));
    }
    throw new Error('expected domain or ModelsPack');
};
exports.createModelStore = (tradle) => new ModelStore(tradle);
//# sourceMappingURL=model-store.js.map