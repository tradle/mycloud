import _ from 'lodash'
import format from 'string-format'
import Logger from '../logger'
import serverlessYml from '../cli/serverless-yml'
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
// const logger = new Logger('service-map')

for (let logicalId in map) {
  map[logicalId] = format(map[logicalId], { service, stage, prefix })
}

for (let key in environment) {
  // if (process.env[key] && !_.isEqual(process.env[key], environment[key])) {
  //   console.log('OVERRIDDING', JSON.stringify(environment[key]), 'WITH', JSON.stringify(process.env[key]))
  // }

  let val = process.env[key] || environment[key]
  // setting obj-valued props on process.env turns them into strings against their will
  if (val === '[object Object]') val = environment[key]

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
