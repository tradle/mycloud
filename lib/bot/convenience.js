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
const omit = require("object.omit");
const constants_1 = require("@tradle/constants");
const buildResource = require("@tradle/build-resource");
const validateResource = require("@tradle/validate-resource");
const crypto_1 = require("../crypto");
const { parseStub } = validateResource.utils;
function addConvenienceMethods(bot) {
    bot.getResource = ({ type, permalink }) => __awaiter(this, void 0, void 0, function* () {
        return yield bot.db.get({
            [constants_1.TYPE]: type,
            _permalink: permalink
        });
    });
    bot.getResourceByStub = (stub) => __awaiter(this, void 0, void 0, function* () {
        return yield bot.getResource(parseStub(stub));
    });
    bot.resolveEmbeds = bot.objects.resolveEmbeds;
    bot.presignEmbeddedMediaLinks = bot.objects.presignEmbeddedMediaLinks;
    bot.createNewVersion = (resource) => __awaiter(this, void 0, void 0, function* () {
        const latest = buildResource.version(resource);
        const signed = yield bot.sign(latest);
        crypto_1.addLinks(signed);
        return signed;
    });
    bot.signAndSave = (resource) => __awaiter(this, void 0, void 0, function* () {
        const signed = yield bot.sign(resource);
        crypto_1.addLinks(signed);
        yield bot.save(signed);
        return signed;
    });
    bot.versionAndSave = (resource) => __awaiter(this, void 0, void 0, function* () {
        const newVersion = yield bot.createNewVersion(resource);
        yield bot.save(newVersion);
        return newVersion;
    });
    bot.reSign = function reSign(object) {
        return bot.sign(omit(object, [constants_1.SIG]));
    };
}
exports.default = addConvenienceMethods;
//# sourceMappingURL=convenience.js.map