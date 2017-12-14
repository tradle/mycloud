"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const lambda_1 = require("./lambda");
class LambdaHttp extends lambda_1.Lambda {
    constructor() {
        super(...arguments);
        this.response = (body, statusCode = 200) => {
            if (statusCode >= 400) {
                console.error(body, this.event);
            }
            return this.callback(null, {
                statusCode,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Credentials': true,
                },
                body: JSON.stringify(body)
            });
        };
    }
    get body() {
        const { body = {} } = this.event;
        return typeof body === 'string' ? JSON.parse(body) : body;
    }
    get queryParams() {
        return this.event.queryStringParameters || {};
    }
    get params() {
        return this.event.pathParameters || {};
    }
    get correlationId() {
        return this.event.requestContext.requestId;
    }
}
exports.LambdaHttp = LambdaHttp;
//# sourceMappingURL=lambda-http.js.map