"use strict";
const base = require('@tradle/models').models;
const shared = require('@tradle/models-shared');
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
module.exports = Object.assign({}, shared, cloud);
//# sourceMappingURL=models.js.map