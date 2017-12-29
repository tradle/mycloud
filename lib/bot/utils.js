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
const lodash_1 = require("lodash");
const typeforce = require("typeforce");
const constants_1 = require("@tradle/constants");
const buildResource = require("@tradle/build-resource");
const validateResource = require("@tradle/validate-resource");
const Errors = require("../errors");
const string_utils_1 = require("../string-utils");
const types = require("../typeforce-types");
const SIMPLE_MESSAGE = 'tradle.SimpleMessage';
const IGNORE_PAYLOAD_TYPES = {
    inbound: [
        'tradle.Message',
        'tradle.CustomerWaiting'
    ],
    outbound: [
        'tradle.Message',
        'tradle.CustomerWaiting',
    ]
};
const getMessagePayload = ({ bot, message }) => __awaiter(this, void 0, void 0, function* () {
    if (message.object[constants_1.SIG]) {
        return message.object;
    }
    return bot.objects.get(buildResource.link(message.object));
});
exports.getMessagePayload = getMessagePayload;
const summarize = (payload) => {
    switch (payload[constants_1.TYPE]) {
        case SIMPLE_MESSAGE:
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
    const base = lodash_1.pick(message, ['context', 'forward', 'originalSender']);
    const payload = message.object;
    return Object.assign({}, base, { type: payload[constants_1.TYPE], permalink: payload._permalink, summary: summarize(payload) });
};
exports.getMessageGist = getMessageGist;
const normalizeSendOpts = (bot, opts) => __awaiter(this, void 0, void 0, function* () {
    let { link, object, to } = opts;
    if (typeof object === 'string') {
        object = {
            [constants_1.TYPE]: SIMPLE_MESSAGE,
            message: object
        };
    }
    if (!object && link) {
        object = yield bot.objects.get(link);
    }
    try {
        if (object[constants_1.SIG]) {
            typeforce(types.signedObject, object);
        }
        else {
            typeforce(types.unsignedObject, object);
        }
        typeforce({
            to: typeforce.oneOf(typeforce.String, typeforce.Object),
            other: typeforce.maybe(typeforce.Object)
        }, opts);
    }
    catch (err) {
        throw new Errors.InvalidInput(`invalid params to send: ${string_utils_1.prettify(opts)}, err: ${err.message}`);
    }
    bot.objects.presignEmbeddedMediaLinks(object);
    opts = lodash_1.omit(opts, 'to');
    opts.recipient = normalizeRecipient(to);
    const { models } = bot;
    const payload = opts.object;
    const model = models[payload[constants_1.TYPE]];
    if (model) {
        try {
            validateResource({ models, model, resource: payload });
        }
        catch (err) {
            bot.logger.error('failed to validate resource', {
                resource: payload,
                error: err.stack
            });
            throw err;
        }
    }
    return opts;
});
exports.normalizeSendOpts = normalizeSendOpts;
const normalizeRecipient = to => to.id || to;
exports.normalizeRecipient = normalizeRecipient;
const savePayloadToDB = ({ bot, message }) => __awaiter(this, void 0, void 0, function* () {
    const type = message._payloadType;
    const { logger } = bot;
    const ignored = message._inbound ? IGNORE_PAYLOAD_TYPES.inbound : IGNORE_PAYLOAD_TYPES.outbound;
    if (ignored.includes(type)) {
        logger.debug(`not saving ${type} to type-differentiated table`);
        return false;
    }
    const table = bot.db.tables[type];
    if (!table) {
        logger.debug(`not saving "${type}", don't have a table for it`);
        return;
    }
    const payload = yield getMessagePayload({ bot, message });
    Object.assign(message.object, payload);
    yield bot.save(message.object);
});
exports.savePayloadToDB = savePayloadToDB;
//# sourceMappingURL=utils.js.map