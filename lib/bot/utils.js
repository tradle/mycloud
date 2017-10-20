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
const pick = require("object.pick");
const constants_1 = require("@tradle/constants");
const buildResource = require("@tradle/build-resource");
const getMessagePayload = ({ bot, message }) => __awaiter(this, void 0, void 0, function* () {
    if (message.object[constants_1.SIG]) {
        return message.object;
    }
    return bot.objects.get(buildResource.link(message.object));
});
exports.getMessagePayload = getMessagePayload;
const summarize = (payload) => {
    switch (payload[constants_1.TYPE]) {
        case 'tradle.SimpleMessage':
            return payload.message;
        case 'tradle.ProductRequest':
            return `for ${payload.requestFor}`;
        case 'tradle.Verification':
            return `for ${payload.document.id}`;
        case 'tradle.FormRequest':
            return `for ${payload.form}`;
        default:
            return JSON.stringify(payload).slice(0, 200) + '...';
    }
};
exports.summarize = summarize;
const getMessageGist = (message) => {
    const base = pick(message, ['context', 'forward', 'originalSender']);
    const payload = message.object;
    return Object.assign({}, base, { type: payload[constants_1.TYPE], permalink: payload._permalink, summary: summarize(payload) });
};
exports.getMessageGist = getMessageGist;
//# sourceMappingURL=utils.js.map