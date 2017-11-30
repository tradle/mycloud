const { ENV_RESOURCE_PREFIX } = require('./constants');
const RESOURCE_REGEX = new RegExp(`^${ENV_RESOURCE_PREFIX}([^_]*)_(.*)$`);
exports = module.exports = resourcesForEnv;
exports.isResourceEnvironmentVariable = str => RESOURCE_REGEX.test(str);
function resourcesForEnv({ env }) {
    const { logger } = env;
    const { SERVERLESS_SERVICE_NAME, SERVERLESS_STAGE, IS_OFFLINE } = env;
    const upperFirst = str => str.charAt(0).toUpperCase() + str.slice(1);
    const resources = {};
    Object.keys(env)
        .map(key => {
        const match = RESOURCE_REGEX.exec(key);
        if (!match)
            return;
        let type = match[1].toLowerCase();
        type = type === 'restapi'
            ? 'RestApi'
            : upperFirst(type);
        return {
            key,
            type,
            name: match[2]
        };
    })
        .filter(truthy)
        .forEach(register);
    function register({ key, type, name }) {
        if (!resources[type]) {
            resources[type] = {};
        }
        let value;
        if (type === 'RestApi') {
            value = env.IS_OFFLINE
                ? env.SERVERLESS_OFFLINE_APIGW || `http://localhost:${env.SERVERLESS_OFFLINE_PORT}`
                : `https://${env[key]}.execute-api.us-east-1.amazonaws.com/${SERVERLESS_STAGE}/${SERVERLESS_SERVICE_NAME}`;
        }
        else {
            value = env[key];
        }
        logger.silly(`registered ${type} ${name} -> ${value}`);
        resources[type][name] = value;
    }
    function truthy(obj) {
        return !!obj;
    }
    return resources;
}
//# sourceMappingURL=service-map.js.map