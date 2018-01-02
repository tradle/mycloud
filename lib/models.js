"use strict";
const mergeModels = require("@tradle/merge-models");
const plugin_onfido_1 = require("@tradle/plugin-onfido");
const base = require('@tradle/models').models;
const custom = require('@tradle/custom-models');
const corporate = require('@tradle/models-corporate-onboarding');
const nz = require('@tradle/models-nz');
const deploymentModels = require('./deployment-models.json');
const onfidoVerificationModels = require('./onfido-verification-models.json');
const mergeOpts = { validate: false };
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
const cloud = Object.assign({}, deploymentModels, onfidoVerificationModels, { 'tradle.MyCloudFriend': require('./tradle.MyCloudFriend.json'), 'tradle.GraphQLQuery': require('./tradle.GraphQLQuery.json'), 'tradle.IotSession': require('./tradle.IotSession.json') });
module.exports = mergeModels()
    .add(base, mergeOpts)
    .add(custom, mergeOpts)
    .add(plugin_onfido_1.models.all, mergeOpts)
    .add(corporate, mergeOpts)
    .add(nz, mergeOpts)
    .add(cloud, mergeOpts)
    .get();
//# sourceMappingURL=models.js.map