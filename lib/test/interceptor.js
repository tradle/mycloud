const path = require('path');
const sinon = require('sinon');
const serverlessYaml = require('../cli/serverless-yml');
const { aws, utils, env } = require('../');
const { co, pick, extend, promisify } = require('../utils');
const createBot = require('../bot');
module.exports = function ({ bot, tradle }) {
    const { delivery, auth, aws, prefix } = tradle;
    const { mqtt } = delivery;
    const sandbox = sinon.sandbox.create();
    const lambdas = createBot.lambdas(bot);
    const noMQTT = {};
    sandbox.stub(auth, 'getLiveSessionByPermalink').callsFake(co(function* (recipient) {
        return {
            clientId: noMQTT[recipient] ? null : 'fakeclientid',
            permalink: recipient
        };
    }));
    sandbox.httpOnly = function (permalink) {
        noMQTT[permalink] = true;
    };
    sandbox.stub(mqtt, 'deliverBatch').callsFake(co(function* ({ recipient, messages }) {
        mqtt.emit('messages', { recipient, messages });
        for (const message of messages) {
            mqtt.emit('message', { recipient, message });
        }
    }));
    sandbox.stub(mqtt, 'ack').callsFake(co(function* (...args) {
        mqtt.emit('ack', ...args);
    }));
    sandbox.stub(mqtt, 'reject').callsFake(co(function* (...args) {
        mqtt.emit('reject', ...args);
    }));
    sandbox.stub(aws.lambda, 'invoke').callsFake(function ({ InvocationType, FunctionName, Payload }) {
        Payload = JSON.parse(Payload);
        const name = FunctionName.slice(prefix.length);
        const conf = serverlessYaml.functions[name];
        const { handler } = conf;
        const [file, handleName] = handler.split('.');
        const lambdaHandler = lambdas[handleName];
        const exec = promisify(lambdaHandler);
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