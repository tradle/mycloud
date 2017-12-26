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
const dotProp = require("dot-prop");
const constants_1 = require("@tradle/constants");
const TERMS_AND_CONDITIONS = 'tradle.TermsAndConditions';
const DATE_PRESENTED_PROP = 'tsAndCsState.datePresented';
const DATE_ACCEPTED_PROP = 'tsAndCsState.dateAccepted';
exports.createPlugin = ({ logger, productsAPI, termsAndConditions }) => {
    const onmessage = (req) => __awaiter(this, void 0, void 0, function* () {
        const { user, payload, type } = req;
        if (type === TERMS_AND_CONDITIONS &&
            payload.termsAndConditions.trim() === termsAndConditions.value.trim()) {
            logger.debug(`updating ${user.id}.${DATE_ACCEPTED_PROP}`);
            dotProp.set(user, DATE_ACCEPTED_PROP, Date.now());
            return;
        }
        const accepted = yield exports.ensureAccepted({
            termsAndConditions,
            user,
            productsAPI,
            logger
        });
        if (!accepted)
            return false;
    });
    return {
        onmessage
    };
};
exports.ensureAccepted = ({ req, termsAndConditions, user, productsAPI, logger }) => __awaiter(this, void 0, void 0, function* () {
    const dateAccepted = dotProp.get(user, DATE_ACCEPTED_PROP);
    if (dateAccepted && dateAccepted > termsAndConditions.lastModified) {
        return true;
    }
    const datePresented = dotProp.get(user, DATE_PRESENTED_PROP);
    if (!(datePresented && datePresented > termsAndConditions.lastModified)) {
        dotProp.set(user, DATE_PRESENTED_PROP, Date.now());
        logger.debug(`requesting ${user.id} to accept T's and C's`);
        yield productsAPI.requestItem({
            req: req || productsAPI.state.newRequestState({ user }),
            item: {
                form: 'tradle.TermsAndConditions',
                prefill: {
                    [constants_1.TYPE]: 'tradle.TermsAndConditions',
                    termsAndConditions: termsAndConditions.value
                }
            }
        });
    }
    logger.debug(`${user.id} has still not accepted T's and C's!`);
    return false;
});
//# sourceMappingURL=ts-and-cs.js.map