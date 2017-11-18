"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
process.env.LAMBDA_BIRTH_DATE = Date.now();
const _1 = require("../../");
const http_request_handler_1 = require("../../http-request-handler");
const handler = http_request_handler_1.createHandler(_1.tradle);
exports.handler = handler;
//# sourceMappingURL=default.js.map