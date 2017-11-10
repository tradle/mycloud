const fs = require('fs');
const path = require('path');
const YAML = require('js-yaml');
const serverlessYmlPath = path.join(__dirname, '../../serverless-interpolated.yml');
const serverlessYml = YAML.load(fs.readFileSync(serverlessYmlPath), { encoding: 'utf8' });
const { Resources } = serverlessYml.resources;
const tables = Object.keys(Resources)
    .filter(name => Resources[name].Type === 'AWS::DynamoDB::Table');
if (!Resources.ServerlessDeploymentBucket) {
    Resources.ServerlessDeploymentBucket = {
        Type: 'AWS::S3::Bucket'
    };
}
if (!Resources.ApiGatewayRestApi) {
    Resources.ApiGatewayRestApi = {
        Type: 'AWS::ApiGateway::RestApi'
    };
}
tables.forEach(name => {
    const { Type, Properties } = Resources[name];
    if (Properties.StreamSpecification) {
        Properties.StreamSpecification.StreamEnabled = true;
    }
});
module.exports = serverlessYml;
//# sourceMappingURL=serverless-yml.js.map