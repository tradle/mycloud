"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const path = require("path");
const sinon = require("sinon");
const serverlessYml = require("../cli/serverless-yml");
const utils_1 = require("../utils");
module.exports = function ({ bot, tradle }) {
    const { env, delivery, auth, aws, prefix } = tradle;
    const { mqtt } = delivery;
    const sandbox = sinon.sandbox.create();
    const noMQTT = {};
    sandbox.stub(auth, 'getLiveSessionByPermalink').callsFake((recipient) => __awaiter(this, void 0, void 0, function* () {
        return {
            clientId: noMQTT[recipient] ? null : 'fakeclientid',
            permalink: recipient
        };
    }));
    sandbox.httpOnly = function (permalink) {
        noMQTT[permalink] = true;
    };
    sandbox.stub(mqtt, 'deliverBatch').callsFake(({ recipient, messages }) => __awaiter(this, void 0, void 0, function* () {
        mqtt.emit('messages', { recipient, messages });
        for (const message of messages) {
            mqtt.emit('message', { recipient, message });
        }
    }));
    sandbox.stub(mqtt, 'ack').callsFake((...args) => __awaiter(this, void 0, void 0, function* () {
        mqtt.emit('ack', ...args);
    }));
    sandbox.stub(mqtt, 'reject').callsFake((...args) => __awaiter(this, void 0, void 0, function* () {
        mqtt.emit('reject', ...args);
    }));
    sandbox.stub(aws.lambda, 'invoke').callsFake(function ({ InvocationType, FunctionName, Payload }) {
        Payload = JSON.parse(Payload);
        const name = FunctionName.slice(prefix.length);
        const conf = serverlessYml.functions[name];
        const { handler } = conf;
        const [file, handleName] = handler.split('.');
        const module = require(path.resolve(__dirname, '../../', file));
        const lambdaHandler = module[handleName];
        const exec = utils_1.promisify(lambdaHandler);
        const promise = exec(Payload, {}).then(() => {
            return { StatusCode: 200 };
        }, err => {
            return { StatusCode: 400, Payload: err.stack };
        });
        return {
            promise: () => promise
        };
    });
    return sandbox;
};
//# sourceMappingURL=interceptor.js.map