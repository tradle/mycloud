"use strict";
const format = require("string-format");
const logger_1 = require("../logger");
const serverlessYml = require("../cli/serverless-yml");
const { custom, provider, resources } = serverlessYml;
const { prefix } = custom;
const { environment } = provider;
const { Resources } = resources;
const map = require('./fixtures/fake-service-map');
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
            continue;
        }
        let { Type, Properties } = resource;
        if (Type === 'AWS::DynamoDB::Table') {
            map[key] = Properties.TableName;
        }
        else if (Type === 'AWS::S3::Bucket') {
            map[key] = `${prefix}${Ref.toLowerCase()}`;
        }
    }
    else {
        map[key] = val;
    }
}
module.exports = map;
//# sourceMappingURL=service-map.js.map