const mergeModels = require('@tradle/merge-models');
const mergeOpts = { validate: false };
const base = require('@tradle/models').models;
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
const custom = require('@tradle/custom-models');
const cloud = {
    'tradle.MyCloudFriend': require('./tradle.MyCloudFriend.json'),
    'tradle.GraphQLQuery': require('./tradle.GraphQLQuery.json'),
    'tradle.IotSession': require('./tradle.IotSession.json'),
    'tradle.OnfidoVerification': require('./tradle.OnfidoVerification.json')
};
module.exports = mergeModels()
    .add(base, mergeOpts)
    .add(custom, mergeOpts)
    .add(cloud, mergeOpts)
    .get();
//# sourceMappingURL=models.js.map