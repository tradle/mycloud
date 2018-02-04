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
const baseModels = require("../../models");
const utils_1 = require("../../utils");
const constants_1 = require("../constants");
const BASE_MODELS_IDS = Object.keys(baseModels);
const mapModelsToPack = new Map();
exports.name = 'keepModelsFresh';
exports.getDefaultIdentifierFromReq = ({ user }) => user.id;
exports.createPlugin = ({ getModelsPackForUser, getIdentifier = exports.getDefaultIdentifierFromReq, send }) => {
    return (req) => __awaiter(this, void 0, void 0, function* () {
        const identifier = getIdentifier(req);
        const { user } = req;
        let modelsPack = getModelsPackForUser(user);
        if (utils_1.isPromise(modelsPack)) {
            modelsPack = yield modelsPack;
        }
        if (!modelsPack)
            return;
        yield exports.sendModelsPackIfUpdated({
            user,
            modelsPack,
            identifier,
            send: object => send({ req, to: user, object })
        });
    });
};
exports.sendModelsPackIfUpdated = ({ user, modelsPack, send, identifier }) => __awaiter(this, void 0, void 0, function* () {
    if (!identifier)
        identifier = user.id;
    if (!user[constants_1.MODELS_HASH_PROPERTY] || typeof user[constants_1.MODELS_HASH_PROPERTY] !== 'object') {
        user[constants_1.MODELS_HASH_PROPERTY] = {};
    }
    const versionId = user[constants_1.MODELS_HASH_PROPERTY][identifier];
    if (modelsPack.versionId === versionId) {
        return false;
    }
    user[constants_1.MODELS_HASH_PROPERTY][identifier] = modelsPack.versionId;
    yield send(modelsPack);
    return true;
});
exports.createGetIdentifierFromReq = ({ employeeManager }) => {
    return req => {
        const { user, message } = req;
        const { originalSender } = message;
        let identifier = user.id;
        if (originalSender) {
            identifier += ':' + originalSender;
        }
        return identifier;
    };
};
exports.createModelsPackGetter = ({ bot, productsAPI, employeeManager }) => {
    return (user) => __awaiter(this, void 0, void 0, function* () {
        if (employeeManager.isEmployee(user)) {
            return yield bot.modelStore.getCumulativeModelsPack();
        }
        return bot.modelStore.myModelsPack;
    });
};
//# sourceMappingURL=keep-models-fresh.js.map