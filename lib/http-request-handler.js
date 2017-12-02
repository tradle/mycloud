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
const serverlessHTTP = require("serverless-http");
const _1 = require("./");
const { cachifyPromiser } = _1.utils;
function createHandler({ router, env }) {
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
    return serverlessHTTP(router, {
        binary: binaryMimeTypes,
        request: (request, event, context) => __awaiter(this, void 0, void 0, function* () {
            env.setFromLambdaEvent({ event, context, source: 'http' });
            request.context = context;
            request.event = event;
            return request;
        }),
        response: () => __awaiter(this, void 0, void 0, function* () {
            yield env.finishAsyncTasks();
        })
    });
}
exports.createHandler = createHandler;
//# sourceMappingURL=http-request-handler.js.map