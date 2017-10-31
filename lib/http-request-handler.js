"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const serverlessHTTP = require("serverless-http");
const _1 = require("./");
const { router, env, discovery, utils } = _1.tradle;
const { cachifyPromiser } = utils;
const { TESTING } = env;
const binaryMimeTypes = TESTING
    ? []
    : [
        "application/javascript",
        "application/json",
        "application/octet-stream",
        "application/xml",
        "font/eot",
        "font/opentype",
        "font/otf",
        "image/jpeg",
        "image/png",
        "image/svg+xml",
        "text/comma-separated-values",
        "text/css",
        "text/html",
        "text/javascript",
        "text/plain",
        "text/text",
        "text/xml"
    ];
const discoverServices = cachifyPromiser(() => __awaiter(this, void 0, void 0, function* () {
    const serviceMap = yield discovery.discoverServices();
    env.set(serviceMap);
}));
module.exports = serverlessHTTP(router, {
    binary: binaryMimeTypes,
    request: (request, event, context) => __awaiter(this, void 0, void 0, function* () {
        env.setFromLambdaEvent({ event, context, source: 'apigateway' });
        request.context = context;
        request.event = event;
        return request;
    })
});
//# sourceMappingURL=http-request-handler.js.map