import transform from 'lodash/transform'
import format from 'string-format'
import { getStackName, getLocalResourceName } from '../cli/utils'
import serverlessYml from '../cli/serverless-yml'
import { parseEnvVarName } from '../service-map'
const {
  service,
  custom,
  provider,
  resources
} = serverlessYml

const { prefix } = custom
const { region, stage, environment } = provider
const { Resources } = resources
const stackName = getStackName()
const fakeMap = require('./fixtures/fake-service-map')
// const logger = new Logger('service-map')

const map = transform(fakeMap, (result, value, logicalId) => {
  result[logicalId] = format(value, { service, stage, prefix })
})

Object.keys(environment).forEach(key => {
  // if (process.env[key] && !_.isEqual(process.env[key], environment[key])) {
  //   console.log('OVERRIDDING', JSON.stringify(environment[key]), 'WITH', JSON.stringify(process.env[key]))
  // }

  let val = process.env[key] || environment[key]
  // setting obj-valued props on process.env turns them into strings against their will
  if (val === '[object Object]') val = environment[key]

  const ref = val.Ref || val['Fn::GetAtt']
  if (!ref) {
    map[key] = val
    return
  }

  const parsed = parseEnvVarName(key)
  if (!parsed) return

  const { type, name } = parseEnvVarName(key)
  if (type === 'Stack') {
    map[key] = `arn:aws:cloudformation:${region}:123456789012:stack/${(name || stackName)}/12345678-1234-1234-1234-123456789012`
  } else {
    map[key] = getLocalResourceName({ stackName, name })
  }
})

export = map
