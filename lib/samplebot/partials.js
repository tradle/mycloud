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
const Promise = require("bluebird");
const _ = require("lodash");
const constants_1 = require("@tradle/constants");
const engine = require("@tradle/engine");
exports.createPlugin = opts => {
    const { onmessage } = new Partials(opts);
    return { onmessage };
};
class Partials {
    constructor({ bot, productsAPI, models, conf }) {
        this.onmessage = (opts) => __awaiter(this, void 0, void 0, function* () {
            const { getRecipients } = this.conf;
            const recipients = getRecipients(opts);
            if (recipients && recipients.length) {
                yield Promise.map(recipients, to => this.sendPartial(Object.assign({}, opts, { to })));
            }
        });
        this.sendPartial = ({ req, message, payload, to }) => __awaiter(this, void 0, void 0, function* () {
            const { productsAPI, filterValues } = this.conf;
            const builder = engine.partial.from(payload);
            const keepValues = Object.keys(payload).filter(property => {
                if (property === constants_1.SIG)
                    return false;
                return filterValues({
                    message,
                    object: payload,
                    property,
                    to
                });
            });
            keepValues.forEach(property => builder.add({
                property,
                key: true,
                value: true
            }));
            const other = {
                originalSender: message._author
            };
            if (message.context)
                other.context = message.context;
            const partial = builder.build();
            return yield this.productsAPI.send({ req, to, object: partial });
        });
        this.bot = bot;
        this.productsAPI = productsAPI;
        this.models = models;
        this.conf = _.defaults(conf, confDefaults);
        this.onmessage = this.onmessage.bind(this);
    }
}
exports.Partials = Partials;
const confDefaults = {
    filterValues: (opts) => false,
    getRecipients: (opts) => []
};
//# sourceMappingURL=partials.js.map