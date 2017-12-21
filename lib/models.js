"use strict";
const mergeModels = require("@tradle/merge-models");
const models_1 = require("@tradle/models");
const custom = require("@tradle/custom-models");
const mergeOpts = { validate: false };
const baseMessageModel = models_1.models['tradle.Message'];
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
const cloud = {
    'tradle.MyCloudFriend': require('./tradle.MyCloudFriend.json'),
    'tradle.GraphQLQuery': require('./tradle.GraphQLQuery.json'),
    'tradle.IotSession': require('./tradle.IotSession.json'),
    'tradle.OnfidoVerification': require('./tradle.OnfidoVerification.json')
};
module.exports = mergeModels()
    .add(models_1.models, mergeOpts)
    .add(custom, mergeOpts)
    .add(cloud, mergeOpts)
    .get();
//# sourceMappingURL=models.js.map