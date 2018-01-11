"use strict";
const _ = require("lodash");
const base = _.extend({}, require('@tradle/models').models, require('@tradle/custom-models'), require('@tradle/models-corporate-onboarding'), require('@tradle/models-products-bot'), require('@tradle/models-onfido'), require('@tradle/models-nz'));
const cloud = require('@tradle/models-cloud');
const baseMessageModel = base['tradle.Message'];
baseMessageModel.properties._counterparty = {
    type: 'string',
    virtual: true
};
if (!baseMessageModel.properties._inbound) {
    baseMessageModel.properties._inbound = {
        type: 'boolean',
        virtual: true
    };
}
if (!baseMessageModel.properties._deliveryStatus) {
    baseMessageModel.properties._deliveryStatus = {
        type: 'string',
        virtual: true
    };
}
module.exports = _.extend(base, cloud);
//# sourceMappingURL=models.js.map