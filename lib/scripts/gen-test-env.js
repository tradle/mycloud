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
process.env.IS_LAMBDA_ENVIRONMENT = 'false';
const path = require("path");
const promisify = require("pify");
const _fs = require("fs");
const string_utils_1 = require("../string-utils");
const lambda_utils_1 = require("../lambda-utils");
const env_1 = require("../env");
const aws_1 = require("../aws");
const logger_1 = require("../logger");
const _1 = require("../");
const utils_1 = require("../cli/utils");
const serverlessYml = require('../cli/serverless-yml');
const fs = promisify(_fs);
const serviceMapPath = path.resolve(__dirname, '../cli/remote-service-map.json');
const latestTemplatePath = path.resolve(__dirname, '../cli/cloudformation-template.json');
const { service, custom } = serverlessYml;
const prefix = `${service}-${custom.stage}-`;
utils_1.loadCredentials();
const env = new env_1.Env(process.env);
const logger = new logger_1.Logger('gen:testenv');
const lambdaUtils = new lambda_utils_1.Utils({
    env,
    aws: aws_1.createAWSWrapper({ logger, env })
});
const getEnv = () => __awaiter(this, void 0, void 0, function* () {
    const setEnvFnName = `${prefix}onmessage`;
    const { Environment } = yield lambdaUtils.getConfiguration(setEnvFnName);
    yield fs.writeFile(serviceMapPath, string_utils_1.prettify(Environment.Variables));
});
const getTemplate = () => __awaiter(this, void 0, void 0, function* () {
    const template = yield utils_1.downloadDeploymentTemplate(_1.createRemoteTradle());
    yield fs.writeFile(latestTemplatePath, string_utils_1.prettify(template));
});
getEnv()
    .then(() => utils_1.loadRemoteEnv())
    .then(() => getTemplate())
    .catch(err => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=gen-test-env.js.map