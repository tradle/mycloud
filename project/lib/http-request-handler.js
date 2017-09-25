"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const serverlessHTTP = require("serverless-http");
const _1 = require("./");
const { TESTING } = _1.env;
const binaryMimeTypes = TESTING ? [] : [
    'application/javascript',
    'application/json',
    'application/octet-stream',
    'application/xml',
    'font/eot',
    'font/opentype',
    'font/otf',
    'image/jpeg',
    'image/png',
    'image/svg+xml',
    'text/comma-separated-values',
    'text/css',
    'text/html',
    'text/javascript',
    'text/plain',
    'text/text',
    'text/xml'
];
module.exports = serverlessHTTP(_1.router, {
    binary: binaryMimeTypes,
    request: (request, event, context) => {
        request.context = context;
        request.event = event;
        return request;
    }
});
//# sourceMappingURL=http-request-handler.js.map