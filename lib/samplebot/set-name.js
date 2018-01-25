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
const constants_1 = require("@tradle/constants");
const validateResource = require("@tradle/validate-resource");
const { parseStub } = validateResource.utils;
const PRODUCT_REQUEST = 'tradle.ProductRequest';
exports.setNamePlugin = ({ bot, productsAPI }) => {
    const logger = bot.logger.sub('plugin-set-name');
    const productToNameForm = {
        'nl.tradle.DigitalPassport': 'tradle.PhotoID',
        'tradle.OnfidoVerification': 'tradle.PhotoID',
        'tradle.CurrentAccount': 'tradle.PersonalInfo'
    };
    const trySetName = (req) => __awaiter(this, void 0, void 0, function* () {
        const { type, payload, application } = req;
        if (!(payload && application))
            return;
        const { requestFor, applicantName, forms = [] } = application;
        if (type === PRODUCT_REQUEST)
            return;
        const nameFormType = productToNameForm[requestFor];
        if (!nameFormType)
            return;
        let form;
        if (payload[constants_1.TYPE] === nameFormType) {
            form = payload;
        }
        else {
            const parsedStub = productsAPI.state.getLatestFormByType(forms, nameFormType);
            if (!parsedStub)
                return;
            form = yield bot.getResource(parsedStub);
        }
        const name = getNameFromForm(form);
        if (name && name.formatted) {
            application.applicantName = name.formatted;
        }
    });
    return {
        'onmessage:tradle.Form': trySetName
    };
};
const getNameFromForm = (form) => {
    let firstName, lastName, formatted;
    const type = form[constants_1.TYPE];
    if (type === 'tradle.BasicContactInfo' || type === 'tradle.PersonalInfo') {
        ({ firstName, lastName } = form);
    }
    else if (type === 'tradle.Name' || type === 'tradle.OnfidoApplicant') {
        firstName = form.givenName;
        lastName = form.surname;
    }
    else if (type === 'tradle.PhotoID') {
        let { scanJson } = form;
        if (scanJson) {
            if (typeof scanJson === 'string') {
                scanJson = JSON.parse(scanJson);
            }
            const { personal = {} } = scanJson;
            if (personal) {
                ({ firstName, lastName } = personal);
            }
        }
    }
    else {
        return null;
    }
    if ((firstName || lastName) && !formatted) {
        formatted = (firstName && lastName)
            ? `${firstName} ${lastName}`
            : firstName || lastName;
    }
    return formatted && { firstName, lastName, formatted };
};
//# sourceMappingURL=set-name.js.map