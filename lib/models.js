const mergeModels = require('@tradle/merge-models');
const mergeOpts = { validate: process.env.NODE_ENV !== 'production' };
const base = mergeModels()
    .add(require('@tradle/models').models, mergeOpts)
    .get();
const baseMessageModel = base['tradle.Message'];
baseMessageModel.properties._counterparty = {
    type: 'string',
    virtual: true
};
const custom = require('@tradle/custom-models');
const cloud = {
    'tradle.MyCloudFriend': require('./tradle.MyCloudFriend.json'),
    'tradle.GraphQLQuery': require('./tradle.GraphQLQuery.json'),
    'tradle.IotSession': require('./tradle.IotSession.json'),
    'tradle.OnfidoVerification': require('./tradle.OnfidoVerification.json')
};
const defaultSet = mergeModels()
    .add(base, mergeOpts)
    .add(custom, mergeOpts)
    .get();
(function () {
    const message = base['tradle.Message'];
    if (message.isInterface)
        return;
    if (!message.properties._inbound) {
        message.properties._inbound = {
            type: 'boolean'
        };
    }
    for (let id in defaultSet) {
        fix(defaultSet[id]);
    }
    function fix(model) {
        model.interfaces = (model.interfaces || []).map(iface => {
            return iface === 'tradle.Message' ? 'tradle.ChatItem' : iface;
        });
        return model;
    }
}());
module.exports = mergeModels()
    .add(defaultSet)
    .add(cloud)
    .get();
//# sourceMappingURL=models.js.map