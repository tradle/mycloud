"use strict";
const require_default_1 = require("./require-default");
const tradle_1 = require("./tradle");
let tradle;
const createTestTradle = (env) => {
    return new tradle_1.default(env || require('./test/env').createTestEnv());
};
const createRemoteTradle = (env) => {
    return new tradle_1.default(env || require('./cli/remote-service-map'));
};
const createTradle = env => {
    if (env)
        return new tradle_1.default(env);
    if (process.env.IS_OFFLINE || process.env.IS_LOCAL) {
        require('./test/env').install();
        return createTestTradle();
    }
    return new tradle_1.default();
};
const exp = {
    get tradle() {
        if (!tradle) {
            tradle = createTradle();
        }
        return tradle;
    },
    get env() {
        return exp.tradle.env;
    },
    createTradle,
    createTestTradle,
    createRemoteTradle,
    get Tradle() {
        return require_default_1.requireDefault('./tradle');
    },
    get Env() {
        return require_default_1.requireDefault('./env');
    },
    get Identities() {
        return require_default_1.requireDefault('./identities');
    },
    get Provider() {
        return require_default_1.requireDefault('./provider');
    },
    get Auth() {
        return require_default_1.requireDefault('./auth');
    },
    get Objects() {
        return require_default_1.requireDefault('./objects');
    },
    get Buckets() {
        return require_default_1.requireDefault('./buckets');
    },
    get Tables() {
        return require_default_1.requireDefault('./tables');
    },
    get Secrets() {
        return require_default_1.requireDefault('./secrets');
    },
    get Friends() {
        return require_default_1.requireDefault('./friends');
    },
    get Errors() {
        return require_default_1.requireDefault('./errors');
    },
    get Events() {
        return require_default_1.requireDefault('./events');
    },
    get Init() {
        return require_default_1.requireDefault('./init');
    },
    get aws() {
        return require_default_1.requireDefault('./aws');
    },
    get awsConfig() {
        return require_default_1.requireDefault('./aws-config');
    },
    get ContentAddressedStorage() {
        return require_default_1.requireDefault('./content-addressed-storage');
    },
    get KeyValueTable() {
        return require_default_1.requireDefault('./key-value-table');
    },
    get User() {
        return require_default_1.requireDefault('./user');
    },
    get Messages() {
        return require_default_1.requireDefault('./messages');
    },
    get Router() {
        return require_default_1.requireDefault('./router');
    },
    get Delivery() {
        return require_default_1.requireDefault('./delivery');
    },
    get Discovery() {
        return require_default_1.requireDefault('./discovery');
    },
    get Seals() {
        return require_default_1.requireDefault('./seals');
    },
    get Blockchain() {
        return require_default_1.requireDefault('./blockchain');
    },
    get Iot() {
        return require_default_1.requireDefault('./iot-utils');
    },
    get S3() {
        return require_default_1.requireDefault('./s3-utils');
    },
    get Lambda() {
        return require_default_1.requireDefault('./lambda-utils');
    },
    get dbUtils() {
        return require_default_1.requireDefault('./db-utils');
    },
    get ServiceMap() {
        return require_default_1.requireDefault('./service-map');
    },
    get stringUtils() {
        return require_default_1.requireDefault('./string-utils');
    },
    get imageUtils() {
        return require_default_1.requireDefault('./image-utils');
    },
    get crypto() {
        return require_default_1.requireDefault('./crypto');
    },
    get utils() {
        return require_default_1.requireDefault('./utils');
    },
    get constants() {
        return require_default_1.requireDefault('./constants');
    },
    get models() {
        return require_default_1.requireDefault('./models');
    },
    get wrap() {
        return require_default_1.requireDefault('./wrap');
    },
    get Bot() {
        return require_default_1.requireDefault('./bot');
    }
};
module.exports = exp;
//# sourceMappingURL=index.js.map