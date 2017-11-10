const mergeModels = require('@tradle/merge-models');
const base = require('@tradle/models').models;
const custom = require('@tradle/custom-models');
const cloud = {
    'tradle.MyCloudFriend': require('./tradle.MyCloudFriend.json'),
    'tradle.GraphQLQuery': require('./tradle.GraphQLQuery.json')
};
const defaultSet = mergeModels()
    .add(base)
    .add(custom)
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