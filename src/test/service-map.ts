const format = require('string-format')
const {
  custom: { prefix },
  provider: { environment },
  resources: {
    Resources
  }
} = require('../cli/serverless-yml')

const map = require('./fixtures/fake-service-map')
for (let logicalId in map) {
  map[logicalId] = format(map[logicalId], { prefix })
}

for (let key in environment) {
  let val = environment[key]
  let { Ref } = val
  if (Ref) {
    let resource = Resources[Ref]
    if (!resource) {
      console.log('not a resource?', key, val)
      continue
    }

    let { Type, Properties } = resource
    if (Type === 'AWS::DynamoDB::Table') {
      map[key] = Properties.TableName
    } else if (Type === 'AWS::S3::Bucket') {
      map[key] = `${prefix}${Ref.toLowerCase()}`
    } else {
      console.log('SKIPPING ENVIRONMENT VARIABLE', key, val)
    }
  } else {
    map[key] = val
  }
}

module.exports = map
