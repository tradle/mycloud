import format = require('string-format')
import Logger from '../logger'
import serverlessYml = require('../cli/serverless-yml')
const {
  service,
  custom,
  provider,
  resources
} = serverlessYml

const { prefix } = custom
const { stage, environment } = provider
const { Resources } = resources
const map = require('./fixtures/fake-service-map')
const logger = new Logger('service-map')

for (let logicalId in map) {
  map[logicalId] = format(map[logicalId], { service, stage, prefix })
}

for (let key in environment) {
  let val = environment[key]
  let { Ref } = val
  if (Ref) {
    let resource = Resources[Ref]
    if (!resource) {
      // logger.debug('not a resource?', key, val)
      continue
    }

    let { Type, Properties } = resource
    if (Type === 'AWS::DynamoDB::Table') {
      map[key] = Properties.TableName
    } else if (Type === 'AWS::S3::Bucket') {
      map[key] = `${prefix}${Ref.toLowerCase()}`
    }
    // else {
    //   logger.debug('SKIPPING ENVIRONMENT VARIABLE', key, val)
    // }
  } else {
    map[key] = val
  }
}

export = map
