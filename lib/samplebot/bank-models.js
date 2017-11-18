"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const clone = require("clone");
const corpModels = require('@tradle/models-corporate-onboarding');
function createBankModels(namespace) {
    const models = clone(corpModels);
    for (let id in models) {
        let { interfaces = [] } = models[id];
        let idx = interfaces.indexOf('tradle.Message');
        if (idx !== -1) {
            interfaces.splice(idx, 1);
        }
    }
    return models;
}
exports.default = createBankModels;
//# sourceMappingURL=bank-models.js.map