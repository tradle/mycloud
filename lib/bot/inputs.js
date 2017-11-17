const co = require('co').wrap;
const pick = require('object.pick');
const tradleDynamo = require('@tradle/dynamodb');
const mergeModels = require('@tradle/merge-models');
const defaultTradleInstance = require('../').tradle;
const createHistory = require('./history');
const createGraphQLAPI = require('./graphql');
const MAX_ITEM_SIZE = 6000;
module.exports = function createBotInputs({ models, tradle = defaultTradleInstance }) {
    const { env, provider, seals, identities, objects, messages, aws, db, kv, conf, contentAddressedStorage, router } = tradle;
    const { docClient } = aws;
    if (models) {
        db.addModels(models);
    }
    ({ models } = db);
    let graphqlAPI;
    if (env.TESTING || /graphql/.test(env.FUNCTION_NAME)) {
        graphqlAPI = createGraphQLAPI({
            env,
            router,
            objects,
            models,
            db,
            prefix: env.SERVERLESS_PREFIX,
            messages,
            presignEmbeddedMediaLinks: objects.presignEmbeddedMediaLinks
        });
    }
    const seal = co(function* ({ link, permalink }) {
        const chainKey = yield provider.getMyChainKey();
        yield seals.create({
            link,
            permalink,
            key: chainKey
        });
    });
    const send = opts => provider.sendMessage(opts);
    const sign = (object, author) => provider.signObject({ object, author });
    return {
        aws,
        env,
        models,
        db,
        conf: conf.sub('bot'),
        kv: kv.sub('bot'),
        contentAddressedStorage,
        resources: pick(tradle, ['tables', 'buckets']),
        messages,
        identities: {
            byPermalink: identities.getIdentityByPermalink,
            byPub: identities.getIdentityByPub,
            byPubMini: identities.getIdentityMetadataByPub,
            addAuthorInfo: identities.addAuthorInfo,
            addContact: identities.validateAndAdd
        },
        objects: {
            get: objects.get,
            put: objects.put,
            validateNewVersion: objects.validateNewVersion,
            getEmbeds: objects.getEmbeds,
            resolveEmbeds: objects.resolveEmbeds,
            presignEmbeddedMediaLinks: objects.presignEmbeddedMediaLinks
        },
        getMyIdentity: provider.getMyPublicIdentity,
        seals,
        seal,
        send,
        sign,
        history: createHistory(tradle),
        graphqlAPI
    };
};
//# sourceMappingURL=inputs.js.map