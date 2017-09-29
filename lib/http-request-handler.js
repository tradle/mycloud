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
require("source-map-support/register");
const serverlessHTTP = require("serverless-http");
const _1 = require("./");
const { cachifyPromiser } = _1.utils;
const { TESTING } = _1.env;
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
    const serviceMap = yield _1.discovery.discoverServices();
    _1.env.set(serviceMap);
}));
module.exports = serverlessHTTP(_1.router, {
    binary: binaryMimeTypes,
    request: (request, event, context) => __awaiter(this, void 0, void 0, function* () {
        if (!_1.env.IOT_ENDPOINT) {
            yield discoverServices();
        }
        request.context = context;
        request.event = event;
        return request;
    })
});
//# sourceMappingURL=http-request-handler.js.map