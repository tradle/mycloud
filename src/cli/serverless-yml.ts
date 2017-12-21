import YAML = require('js-yaml')

const serverlessYml = require('../serverless-interpolated')
const { Resources } = serverlessYml.resources
const tables = Object.keys(Resources)
  .filter(name => Resources[name].Type === 'AWS::DynamoDB::Table')

if (!Resources.ServerlessDeploymentBucket) {
  Resources.ServerlessDeploymentBucket = {
    Type: 'AWS::S3::Bucket'
  }
}

if (!Resources.ApiGatewayRestApi) {
  Resources.ApiGatewayRestApi = {
    Type: 'AWS::ApiGateway::RestApi'
  }
}

// normalize tables
tables.forEach(name => {
  const { Type, Properties } = Resources[name]
  if (Properties.StreamSpecification) {
    Properties.StreamSpecification.StreamEnabled = true
  }
})

export = serverlessYml
