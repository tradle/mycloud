import _ from 'lodash'
import { TYPE } from '@tradle/constants'
import { pluck } from '../utils'

const LOCALLY_AVAILABLE = [
  'AWS::DynamoDB::Table',
  'AWS::S3::Bucket',
  'AWS::ApiGateway::RestApi'
]

const { HTTP_METHODS, ENV_RESOURCE_PREFIX } = require('../constants')
const NUM_INDEXES = 5

export {
  forEachResource,
  forEachResourceOfType,
  addCustomResourceDependencies,
  addResourcesToOutputs,
  addHTTPMethodsToEnvironment,
  addResourcesToEnvironment,
  removeResourcesThatDontWorkLocally,
  addBucketTables,
  stripDevFunctions,
  setBucketEncryption
}

function addCustomResourceDependencies (yml, interpolated) {
  const { prefix } = interpolated.custom
  const naming = require('serverless/lib/plugins/aws/lib/naming')
  const lambdas = Object.keys(interpolated.functions).map(shortName => {
    return naming.getLambdaLogicalId(`${prefix}${shortName}`)
  })

  const { Initialize } = yml.resources.Resources
  Initialize.DependsOn = _.uniq(lambdas.concat(Initialize.DependsOn || []))
}

function setBucketEncryption ({ target, interpolated }) {
  const { encryption=[] } = interpolated.custom.vars
  if (!encryption.length) return

  encryption.forEach(bucketName => {
    target.resources.Resources[bucketName].Properties.BucketEncryption = {
      ServerSideEncryptionConfiguration: [
        {
          ServerSideEncryptionByDefault: {
            SSEAlgorithm: 'AES256'
          }
        }
      ]
    }
  })

  // yml.resources.Resources = _.transform(yml.resources.Resources, (result, res, key) => {
  //   if (res.Type !== 'AWS::S3::Bucket') {
  //     result[key] = res
  //   }
  // })
}

function addBucketTables ({ yml, prefix }) {
  const { resources, custom } = yml
  const { tableBuckets } = custom
  if (!tableBuckets) return

  const { Resources } = resources
  const { count, read, write } = tableBuckets
  if (!custom.capacities) custom.capacities = []

  const tables = Object.keys(Resources).filter(name => {
    return Resources[name].Type === 'AWS::DynamoDB::Table'
  })

  for (let i = 0; i < count; i++) {
    let name = `${prefix}bucket-${i}`
    let def = getBucketTableDefinition({
      read,
      write,
      indexes: NUM_INDEXES,
      name,
      dependencies: tables
    })

    let logicalId = `BucketTable${i}`
    Resources[logicalId] = def
    // custom.capacities.push({
    //   table: logicalId,
    //   read,
    //   write,
    //   index
    // })
  }

  return yml
}

function getBucketTableDefinition ({
  name,
  read,
  write,
  indexes,
  dependencies
}) {
  const GlobalSecondaryIndexes = _.range(0, indexes).map(i => ({
    IndexName: `idx${i}`,
    KeySchema: [
      {
        AttributeName: `__x${i}h__`,
        KeyType: 'HASH'
      },
      {
        AttributeName: `__x${i}r__`,
        KeyType: 'RANGE'
      }
    ],
    Projection: {
      ProjectionType: 'ALL'
      // ProjectionType: 'INCLUDE',
      // NonKeyAttributes: [
      //   TYPE, '_link'
      // ]
    },
    ProvisionedThroughput: {
      ReadCapacityUnits: read.minimum,
      WriteCapacityUnits: write.minimum
    }
  }))

  const KeySchema = [
    {
      AttributeName: '__h__',
      KeyType: 'HASH'
    },
    {
      AttributeName: '__r__',
      KeyType: 'RANGE'
    }
  ]

  const KeySchemas = KeySchema.concat(_.flatMap(GlobalSecondaryIndexes, i => i.KeySchema))
  const AttributeDefinitions = KeySchemas.map(({ AttributeName }) => ({
    AttributeName,
    AttributeType: 'S'
  }))

  return {
    Type: 'AWS::DynamoDB::Table',
    Description: `table that stores multiple models`,
    // a trick to avoid exceeding the limits on
    // simultaneous create/update table operations
    DependsOn: dependencies,
    Properties: {
      TableName: name,
      AttributeDefinitions,
      KeySchema,
      ProvisionedThroughput: {
        ReadCapacityUnits: read.minimum,
        WriteCapacityUnits: write.minimum
      },
      StreamSpecification: {
        StreamViewType: 'NEW_AND_OLD_IMAGES'
      },
      GlobalSecondaryIndexes
    }
  }
}

function forEachResource (yaml, fn) {
  const { resources, provider } = yaml
  const { Resources } = resources
  const { environment } = provider

  let updated
  for (let logicalId in Resources) {
    let resource = Resources[logicalId]
    if (logicalId === 'IamRoleLambdaExecution') {
      continue
    }

    if (resource.Type.startsWith('Custom::')) {
      continue
    }

    fn({
      id: logicalId,
      resource: Resources[logicalId]
    })
  }

  fn({
    id: 'ServerlessDeploymentBucket',
    resource: {
      Type: 'AWS::S3::Bucket'
    }
  })

  // fn({
  //   id: 'ApiGatewayRestApi',
  //   resource: {
  //     Type: 'AWS::ApiGateway::RestApi'
  //   }
  // })
}

function forEachLambda (yaml, fn) {
  return forEachResourceOfType(yaml, fn, 'AWS::Lambda::Function')
}

function forEachResourceOfType (yaml, fn, type) {
  forEachResource(yaml, resource => {
    if (resource.Type === type) {
      fn(resource)
    }
  })
}

function stripDevFunctions (yml) {
  const { functions } = yml
  Object.keys(functions).forEach(name => {
    if (name.endsWith('_dev')) {
      delete functions[name]
    }
  })
}

function addResourcesToEnvironment (yaml) {
  const { provider, functions } = yaml
  for (let fnName in functions) {
    addHTTPMethodsToEnvironment(functions[fnName])
  }

  if (!provider.environment) provider.environment = {}

  const { environment } = provider
  forEachResource(yaml, ({ id, resource }) => {
    if (id in environment) {
      throw new Error(`refusing to overwrite environment.${id}`)
    }

    const type = resource.Type.split('::').pop().toUpperCase()
    let shortName = id
    if (id.toUpperCase().endsWith(type)) {
      shortName = shortName.slice(0, id.length - type.length)
    }

    environment[`${ENV_RESOURCE_PREFIX}${type}_${shortName}`] = {
      Ref: id
    }
  })

  environment.R_STACK = {
    Ref: 'AWS::StackId'
  }

  environment[`${ENV_RESOURCE_PREFIX}RESTAPI_ApiGateway`] = {
    Ref: 'ApiGatewayRestApi'
  }
}

function addHTTPMethodsToEnvironment (conf) {
  if (!conf.events) return

  const methods = conf.events.filter(e => e.http)
    .map(e => e.http.method.toUpperCase())

  if (!methods.length) return

  if (!conf.environment) {
    conf.environment = {}
  }

  if (methods.length === 1 && methods[0] === 'ANY') {
    conf.environment.HTTP_METHODS = HTTP_METHODS
  } else {
    conf.environment.HTTP_METHODS = methods
      .concat('OPTIONS')
      .join(',')
  }
}

function addResourcesToOutputs (yaml:any) {
  const { resources } = yaml
  if (!resources.Outputs) resources.Outputs = {}

  const { Outputs } = resources
  forEachResource(yaml, ({ id, resource }) => {
    if (id in Outputs) {
      throw new Error(`refusing to overwrite Outputs.${id}`)
    }

    const output:any = Outputs[id] = {}
    if (resource.Description) {
      output.Description = resource.Description
    }

    output.Value = {
      Ref: id
    }
  })
}

function removeResourcesThatDontWorkLocally ({ provider, resources }) {
  const { Resources } = resources
  resources.Resources = {}
  Object.keys(Resources)
    .forEach(name => {
      const resource = Resources[name]
      if (LOCALLY_AVAILABLE.includes(resource.Type)) {
        resources.Resources[name] = resource
      }
    })

  provider.iamRoleStatements = []
}
