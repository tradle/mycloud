"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const serverlessHTTP = require("serverless-http");
const _1 = require("./");
const { cachifyPromiser } = _1.utils;
function createHandler({ lambda, preProcess, postProcess }) {
    const binaryMimeTypes = lambda.isTesting
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
    return serverlessHTTP(lambda.koa, {
        binary: binaryMimeTypes,
        request: preProcess,
        response: postProcess
    });
}
exports.createHandler = createHandler;
//# sourceMappingURL=http-request-handler.js.map