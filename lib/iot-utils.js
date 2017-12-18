"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const IotMessage = require("@tradle/iot-message");
const utils_1 = require("./utils");
const DEFAULT_QOS = 1;
module.exports = function ({ aws, env, prefix = '' }) {
    const logger = env.logger.sub('iot-utils');
    let iotData;
    const publish = (params) => __awaiter(this, void 0, void 0, function* () {
        params = Object.assign({}, params);
        if (!('qos' in params))
            params.qos = DEFAULT_QOS;
        params.payload = yield IotMessage.encode({
            payload: params.payload,
            encoding: 'gzip'
        });
        logger.debug(`publishing to ${params.topic}`);
        if (!iotData) {
            let endpoint = env.IOT_ENDPOINT;
            if (!endpoint) {
                env.IOT_ENDPOINT = yield getEndpoint();
            }
            iotData = aws.iotData;
        }
        return yield iotData.publish(params).promise();
    });
    const getEndpoint = utils_1.cachifyPromiser(() => __awaiter(this, void 0, void 0, function* () {
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