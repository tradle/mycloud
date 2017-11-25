import format = require('string-format')
import Logger from '../logger'
import map = require('./fixtures/fake-service-map')
import {
  custom,
  provider,
  resources
} from '../cli/serverless-yml'

const { prefix } = custom
const { environment } = provider
const { Resources } = resources
const logger = new Logger('service-map')

for (let logicalId in map) {
  map[logicalId] = format(map[logicalId], { prefix })
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

module.exports = map
