#!/usr/bin/env node
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
const lodash_1 = require("lodash");
const request = require("superagent");
const argv = require('minimist')(process.argv.slice(2), {
    alias: {
        u: 'users',
        p: 'products',
        l: 'local'
    },
    default: {
        users: 1,
        products: ['tradle.CurrentAccount']
    }
});
if (argv.local) {
    process.exit(0);
}
const { SERVERLESS_STAGE, SERVERLESS_SERVICE_NAME, R_RESTAPI_ApiGateway } = require('../test/service-map');
const genSamplesUrl = `https://${R_RESTAPI_ApiGateway}.execute-api.us-east-1.amazonaws.com/${SERVERLESS_STAGE}/${SERVERLESS_SERVICE_NAME}/samples`;
(() => __awaiter(this, void 0, void 0, function* () {
    const res = yield request
        .post(genSamplesUrl)
        .set('Accept', 'application/json')
        .send(lodash_1.pick(argv, ['users', 'products']));
    const { ok, body } = res;
    const text = JSON.stringify(body, null, 2);
    if (!ok) {
        throw new Error(text);
    }
    if (text) {
        console.log(text);
    }
}))()
    .catch(err => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=gen-samples.js.map