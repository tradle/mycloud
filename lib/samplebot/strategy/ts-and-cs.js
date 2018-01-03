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
const constants_1 = require("@tradle/constants");
const TERMS_AND_CONDITIONS = 'tradle.TermsAndConditions';
const DATE_PRESENTED_PROP = 'tsAndCsState.datePresented';
const DATE_ACCEPTED_PROP = 'tsAndCsState.dateAccepted';
const CUSTOMER_WAITING = 'tradle.CustomerWaiting';
const SIMPLE_MESSAGE = 'tradle.SimpleMessage';
const YOU_HAVENT_ACCEPTED = `Please accept our Terms and Conditions before we continue :-)`;
exports.createPlugin = ({ logger, productsAPI, termsAndConditions }) => {
    const onmessage = (req) => __awaiter(this, void 0, void 0, function* () {
        const { user, payload, type } = req;
        if (user.friend)
            return;
        if (type === TERMS_AND_CONDITIONS &&
            payload.termsAndConditions.trim() === termsAndConditions.value.trim()) {
            logger.debug(`updating ${user.id}.${DATE_ACCEPTED_PROP}`);
            _.set(user, DATE_ACCEPTED_PROP, Date.now());
            yield productsAPI.sendProductList(req);
            return;
        }
        const accepted = yield exports.ensureAccepted({
            req,
            termsAndConditions,
            user,
            productsAPI,
            logger
        });
        if (accepted)
            return;
        if (type === SIMPLE_MESSAGE) {
            yield productsAPI.send({
                req,
                object: {
                    [constants_1.TYPE]: SIMPLE_MESSAGE,
                    message: YOU_HAVENT_ACCEPTED
                }
            });
        }
        return false;
    });
    return {
        onmessage
    };
};
exports.ensureAccepted = ({ req, termsAndConditions, user, productsAPI, logger }) => __awaiter(this, void 0, void 0, function* () {
    const dateAccepted = _.get(user, DATE_ACCEPTED_PROP);
    if (dateAccepted && dateAccepted > termsAndConditions.lastModified) {
        return true;
    }
    const datePresented = _.get(user, DATE_PRESENTED_PROP);
    if (!(datePresented && datePresented > termsAndConditions.lastModified)) {
        _.set(user, DATE_PRESENTED_PROP, Date.now());
        logger.debug(`requesting ${user.id} to accept T's and C's`);
        if (!req) {
            req = productsAPI.state.newRequestState({ user });
        }
        yield productsAPI.requestItem({
            req,
            item: {
                form: 'tradle.TermsAndConditions',
                message: 'Hi! Before we begin this beautiful friendship, please review our **Terms and Conditions**',
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