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
const _ = require("lodash");
const ModelsPack = require("@tradle/models-pack");
const baseModels = require("../../models");
const utils_1 = require("../../utils");
const BASE_MODELS_IDS = Object.keys(baseModels);
const mapModelsToPack = new Map();
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
exports.sendModelsPackIfUpdated = ({ user, models, send, identifier, propertyName = exports.defaultPropertyName, }) => __awaiter(this, void 0, void 0, function* () {
    if (!Object.keys(models).length)
        return;
    if (!identifier)
        identifier = exports.getDefaultIdentifierFromUser(user);
    if (!user[propertyName] || typeof user[propertyName] !== 'object') {
        user[propertyName] = {};
    }
    const versionId = user[propertyName][identifier];
    let pack = mapModelsToPack.get(models);
    if (!pack) {
        pack = ModelsPack.pack({ models });
        mapModelsToPack.set(models, pack);
    }
    if (pack.versionId === versionId)
        return;
    user[propertyName][identifier] = pack.versionId;
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
exports.createGetModelsForUser = ({ bot, productsAPI, employeeManager }) => {
    const employeeModels = _.omit(bot.models, BASE_MODELS_IDS);
    const customerModels = employeeModels;
    return user => {
        if (employeeManager.isEmployee(user)) {
            return employeeModels;
        }
        return customerModels;
    };
};
//# sourceMappingURL=keep-models-fresh.js.map