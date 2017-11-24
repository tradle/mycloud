"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const format = require("string-format");
const logger_1 = require("../logger");
const map = require("./fixtures/fake-service-map");
const serverless_yml_1 = require("../cli/serverless-yml");
const { prefix } = serverless_yml_1.custom;
const { environment } = serverless_yml_1.provider;
const { Resources } = serverless_yml_1.resources;
const logger = new logger_1.default('service-map');
for (let logicalId in map) {
    map[logicalId] = format(map[logicalId], { prefix });
}
for (let key in environment) {
    let val = environment[key];
    let { Ref } = val;
    if (Ref) {
        let resource = Resources[Ref];
        if (!resource) {
            logger.debug('not a resource?', key, val);
            continue;
        }
        let { Type, Properties } = resource;
        if (Type === 'AWS::DynamoDB::Table') {
            map[key] = Properties.TableName;
        }
        else if (Type === 'AWS::S3::Bucket') {
            map[key] = `${prefix}${Ref.toLowerCase()}`;
        }
        else {
            logger.debug('SKIPPING ENVIRONMENT VARIABLE', key, val);
        }
    }
    else {
        map[key] = val;
    }
}
module.exports = map;
//# sourceMappingURL=service-map.js.map