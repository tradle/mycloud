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
const Promise = require("bluebird");
const https = require("https");
const url = require("url");
exports.SUCCESS = 'SUCCESS';
exports.FAILED = 'FAILED';
exports.sendSuccess = (event, context, responseData, physicalResourceId) => {
    return exports.send(event, context, exports.SUCCESS, responseData, physicalResourceId);
};
exports.sendError = (event, context, responseData, physicalResourceId) => {
    return exports.send(event, context, exports.FAILED, responseData, physicalResourceId);
};
exports.send = (event, context, responseStatus, responseData, physicalResourceId) => __awaiter(this, void 0, void 0, function* () {
    return new Promise((resolve, reject) => {
        const responseBody = JSON.stringify({
            Status: responseStatus,
            Reason: "See the details in CloudWatch Log Stream: " + context.logStreamName,
            PhysicalResourceId: physicalResourceId || context.logStreamName,
            StackId: event.StackId,
            RequestId: event.RequestId,
            LogicalResourceId: event.LogicalResourceId,
            Data: responseData
        });
        console.log("Response body:\n", responseBody);
        const parsedUrl = url.parse(event.ResponseURL);
        const options = {
            hostname: parsedUrl.hostname,
            port: 443,
            path: parsedUrl.path,
            method: "PUT",
            headers: {
                "content-type": "",
                "content-length": responseBody.length
            }
        };
        const request = https.request(options, response => {
            console.log("Status code: " + response.statusCode);
            console.log("Status message: " + response.statusMessage);
            resolve(response);
        });
        request.on("error", err => {
            console.log("send(..) failed executing https.request(..): " + err);
            reject(err);
        });
        request.write(responseBody);
        request.end();
    });
});
//# sourceMappingURL=cfn-response.js.map