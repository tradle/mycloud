const debug = require('debug')('tradle:sls:iot');
const { co, clone, cachifyPromiser } = require('./utils');
const DEFAULT_QOS = 1;
module.exports = function ({ aws, env, prefix = '' }) {
    let iotData;
    const publish = co(function* (params) {
        params = clone(params);
        if (!('qos' in params))
            params.qos = DEFAULT_QOS;
        if (typeof params.payload === 'object') {
            params.payload = JSON.stringify(params.payload);
        }
        debug(`publishing to ${params.topic}`);
        if (!iotData) {
            let endpoint = env.IOT_ENDPOINT;
            if (!endpoint) {
                env.IOT_ENDPOINT = yield getEndpoint();
            }
            iotData = aws.iotData;
        }
        return yield iotData.publish(params).promise();
    });
    const getEndpoint = cachifyPromiser(co(function* () {
        if (env.IOT_ENDPOINT)
            return env.IOT_ENDPOINT;
        const { endpointAddress } = yield aws.iot.describeEndpoint().promise();
        return endpointAddress;
    }));
    const Iot = {
        publish,
        getEndpoint
    };
    return Iot;
};
//# sourceMappingURL=iot-utils.js.map