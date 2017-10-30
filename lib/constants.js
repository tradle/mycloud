"use strict";
const constants_1 = require("@tradle/constants");
let prefix = '';
const constants = {
    TYPE: constants_1.TYPE,
    PERMALINK: constants_1.PERMALINK,
    PREVLINK: constants_1.PREVLINK,
    LINK: constants_1.LINK,
    SEQ: constants_1.SEQ,
    SIG: constants_1.SIG,
    PREV_TO_RECIPIENT: constants_1.PREV_TO_RECIPIENT,
    NONCE: constants_1.NONCE,
    TYPES: Object.assign({}, constants_1.TYPES, { INTRODUCTION: 'tradle.Introduction', IDENTITY_PUBLISH_REQUEST: 'tradle.IdentityPublishRequest' }),
    IDENTITY_KEYS_KEY: prefix + 'keys.json',
    PUBLIC_CONF_BUCKET: {
        info: prefix + 'info.json',
        identity: prefix + 'identity.json',
        style: prefix + 'style.json'
    },
    HANDSHAKE_TIMEOUT: 30000,
    PUSH_SERVER_URL: 'https://push1.tradle.io',
    WEBHOOKS: {
        initialDelay: 1000,
        maxDelay: 300000,
        maxRetries: 100
    },
    MAX_CLOCK_DRIFT: 10000,
    MAX_DB_ITEM_SIZE: 6000,
    ENV_RESOURCE_PREFIX: 'R_',
    HTTP_METHODS: 'DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT',
    WARMUP_SOURCE_NAME: 'warmup',
    WARMUP_SLEEP: 40
};
module.exports = constants;
//# sourceMappingURL=constants.js.map