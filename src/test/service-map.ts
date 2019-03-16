import transform from 'lodash/transform'
import format from 'string-format'
import getLocalIP from 'localip'
import { getStackName, getLocalResourceName } from '../cli/utils'
import serverlessYml from '../cli/serverless-yml'
import { parseEnvVarName } from '../service-map'
import { getStackParameter } from '../cli/get-stack-parameter'
import { getVar } from '../cli/get-template-var'
const { service, custom, provider, resources } = serverlessYml

const { prefix, blockchain } = custom
const { region, stage, environment } = provider
const { Resources } = resources
const stackName = getStackName()
const fakeMap = require('./fixtures/fake-service-map')
// const logger = new Logger('service-map')

const map = transform(fakeMap, (result, value, logicalId) => {
  result[logicalId] = format(value, { service, stage, stackName })
})

Object.keys(environment).forEach(key => {
  // if (process.env[key] && !_.isEqual(process.env[key], environment[key])) {
  //   console.log('OVERRIDDING', JSON.stringify(environment[key]), 'WITH', JSON.stringify(process.env[key]))
  // }

  let val = process.env[key] || environment[key]
  // setting obj-valued props on process.env turns them into strings against their will
  if (val === '[object Object]') val = environment[key]

  if (key === 'BLOCKCHAIN') {
    map[key] = blockchain
    return
  }

  if (key === 'IOT_ENDPOINT') {
    map[key] = `${getLocalIP()}:${getVar('serverless-iot-local.httpPort')}`
    return
  }

  if (key === 'SEALING_MODE' || key === 'SEAL_BATCHING_PERIOD') {
    map[key] = getStackParameter(val.Ref)
    return
  }

  val = val.Ref || val['Fn::GetAtt'] || val['Fn::Sub'] || val
  if (typeof val !== 'string') {
    map[key] = val
    return
  }

  const parsed = parseEnvVarName(key)
  if (!parsed) {
    map[key] = val.replace(/\$\{AWS::StackName\}/g, stackName).replace(/AWS::StackName/g, stackName)

    return
  }

  const { type, name } = parsed
  if (type === 'Stack') {
    map[key] = `arn:aws:cloudformation:${region}:123456789012:stack/${name ||
      stackName}/12345678-1234-1234-1234-123456789012`
  } else {
    map[key] = getLocalResourceName({ stackName, name })
  }
})

export = map
