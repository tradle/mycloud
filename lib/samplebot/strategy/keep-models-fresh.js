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
const crypto = require("crypto");
const buildResource = require("@tradle/build-resource");
const baseModels = require("../../models");
const utils_1 = require("../../utils");
const BASE_MODELS_IDS = Object.keys(baseModels);
const hashObject = (obj) => hashString('sha256', utils_1.stableStringify(obj));
const hashString = (algorithm, data) => crypto.createHash(algorithm).update(data).digest('hex');
const modelsToArray = (models) => {
    return Object.keys(models)
        .sort(compareAlphabetical)
        .map(id => models[id]);
};
const compareAlphabetical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const objToArray = new Map();
const arrToHash = new Map();
exports.defaultPropertyName = 'modelsHash';
exports.getDefaultIdentifierFromUser = (user) => user.id;
exports.getDefaultIdentifierFromReq = ({ user }) => exports.getDefaultIdentifierFromUser(user);
exports.keepModelsFreshPlugin = ({ getModelsForUser, propertyName = exports.defaultPropertyName, getIdentifier = exports.getDefaultIdentifierFromReq, send }) => {
    return (req) => __awaiter(this, void 0, void 0, function* () {
        const identifier = getIdentifier(req);
        const { user } = req;
        let models = getModelsForUser(user);
        if (utils_1.isPromise(models)) {
            models = yield models;
        }
        yield exports.sendModelsPackIfUpdated({
            user,
            models: getModelsForUser(user),
            propertyName,
            identifier,
            send: object => send({ req, object })
        });
    });
};
exports.sendModelsPackIfUpdated = ({ user, models, propertyName = exports.defaultPropertyName, identifier, send }) => __awaiter(this, void 0, void 0, function* () {
    if (!user[propertyName] || typeof user[propertyName] !== 'object') {
        user[propertyName] = {};
    }
    const modelsHash = user[propertyName][identifier];
    let modelsArray;
    if (Array.isArray(models)) {
        modelsArray = models;
    }
    else {
        modelsArray = objToArray.get(models);
        if (!modelsArray) {
            modelsArray = modelsToArray(models);
            objToArray.set(models, modelsArray);
        }
    }
    let hash = arrToHash.get(modelsArray);
    if (!hash) {
        hash = hashObject(modelsArray);
        arrToHash.set(modelsArray, hash);
    }
    if (hash === modelsHash)
        return;
    user[propertyName][identifier] = hash;
    const pack = buildResource({
        models: baseModels,
        model: 'tradle.ModelsPack',
        resource: {
            models: modelsArray
        }
    })
        .toJSON();
    return yield send(pack);
});
exports.createGetIdentifierFromReq = ({ employeeManager }) => {
    return req => {
        const { user, message } = req;
        const { originalSender } = message;
        let identifier = exports.getDefaultIdentifierFromUser(user);
        if (originalSender) {
            identifier += ':' + originalSender;
        }
        return identifier;
    };
};
exports.createGetModelsForUser = ({ productsAPI, employeeManager }) => {
    const employeeModels = utils_1.omit(productsAPI.models.all, BASE_MODELS_IDS);
    const customerModels = utils_1.omit(productsAPI.models.all, Object.keys(productsAPI.models.private.all)
        .concat(BASE_MODELS_IDS));
    employeeModels['tradle.OnfidoVerification'] = baseModels['tradle.OnfidoVerification'];
    customerModels['tradle.OnfidoVerification'] = baseModels['tradle.OnfidoVerification'];
    return user => {
        if (employeeManager.isEmployee(user)) {
            return employeeModels;
        }
        return customerModels;
    };
};
//# sourceMappingURL=keep-models-fresh.js.map