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
const _1 = require("../../");
const lambda_1 = require("../../lambda");
const lambda = new lambda_1.Lambda({
    source: lambda_1.EventSource.IOT,
    tradle: _1.tradle
});
lambda.use(({ event, context }) => __awaiter(this, void 0, void 0, function* () {
    let { topic, clientId, data } = event;
    if (!clientId && lambda.isUsingServerlessOffline) {
        clientId = topic.match(/\/([^/]+)\/[^/]+/)[1];
    }
    const message = new Buffer(data.data, 'base64');
    yield _1.tradle.user.onSentMessage({ clientId, message });
    lambda.logger.debug('preceived');
}));
exports.handler = lambda.handler;
//# sourceMappingURL=onmessage.js.map