const co = require('co').wrap;
const pick = require('object.pick');
const tradleDynamo = require('@tradle/dynamodb');
const mergeModels = require('@tradle/merge-models');
const createHistory = require('./history');
const MAX_ITEM_SIZE = 6000;
module.exports = function createBotInputs({ models, tradle }) {
    const { env, provider, seals, identities, objects, messages, aws, db, dbUtils, kv, conf, contentAddressedStorage, resources, tables, buckets, router, init, wrap, friends, lambdaUtils, version, apiBaseUrl } = tradle;
    const { docClient } = aws;
    if (models) {
        db.addModels(models);
    }
    ;
    ({ models } = db);
    const seal = co(function* ({ link, permalink }) {
        const chainKey = yield provider.getMyChainKey();
        yield seals.create({
            link,
            permalink,
            key: chainKey
        });
    });
    const send = opts => provider.sendMessageBatch([].concat(opts));
    const sign = (object, author) => provider.signObject({ object, author });
    return {
        init: opts => init.init(opts),
        aws,
        env,
        models,
        db,
        dbUtils,
        router,
        wrap,
        conf: conf.sub(':bot'),
        kv: kv.sub(':bot'),
        contentAddressedStorage,
        resources: {
            tables,
            buckets
        },
        messages,
        friends,
        identities,
        objects,
        getMyIdentity: provider.getMyPublicIdentity,
        seals,
        seal,
        send,
        sign,
        history: createHistory(tradle),
        lambdaUtils,
        version,
        apiBaseUrl
    };
};
//# sourceMappingURL=inputs.js.map