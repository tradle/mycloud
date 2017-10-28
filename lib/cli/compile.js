const { TYPE } = require('@tradle/constants')

const LOCALLY_AVAILABLE = [
  'AWS::DynamoDB::Table',
  'AWS::S3::Bucket',
  'AWS::ApiGateway::RestApi'
]

const { HTTP_METHODS, ENV_RESOURCE_PREFIX } = require('../constants')

module.exports = {
  forEachResource,
  addResourcesToOutputs,
  addHTTPMethodsToEnvironment,
  addResourcesToEnvironment,
  removeResourcesThatDontWorkLocally,
  addBucketTables,
  stripDevFunctions
}

function addBucketTables ({ yml, prefix }) {
  const { resources, custom } = yml
  const { tableBuckets } = custom
  if (!tableBuckets) return

  const { Resources } = resources
  const { count, read, write, index } = tableBuckets
  if (!custom.capacities) custom.capacities = []

  for (let i = 0; i < count; i++) {
    let name = `${prefix}bucket-${i}`
    let def = getTableBucketDefinition({ read, write, index: index[0], name })
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

function getTableBucketDefinition ({
  name,
  read,
  write,
  index
}) {
  return {
    Type: 'AWS::DynamoDB::Table',
    Description: `table that stores multiple models`,
    Properties: {
      TableName: name,
      AttributeDefinitions: [
        {
          AttributeName: '_tpermalink',
          AttributeType: 'S'
        },
        {
          AttributeName: '_author',
          AttributeType: 'S'
        },
        {
          AttributeName: '_time',
          AttributeType: 'N'
        }
      ],
      KeySchema: [
        {
          AttributeName: '_tpermalink',
          KeyType: 'HASH'
        }
      ],
      ProvisionedThroughput: {
        ReadCapacityUnits: read.minimum,
        WriteCapacityUnits: write.minimum
      },
      GlobalSecondaryIndexes: [
        {
          IndexName: index,
          KeySchema: [
            {
              AttributeName: '_author',
              KeyType: 'HASH'
            },
            {
              AttributeName: '_time',
              KeyType: 'RANGE'
            }
          ],
          Projection: {
            ProjectionType: 'ALL'
            // ProjectionType: 'INCLUDE',
            // NonKeyAttributes: [
            //   TYPE
            // ]
          },
          ProvisionedThroughput: {
            ReadCapacityUnits: read.minimum,
            WriteCapacityUnits: write.minimum
          }
        }
      ]
    }
  }
}

function forEachResource (yaml, fn) {
  const { resources, provider } = yaml
  const { Resources } = resources
  const { environment } = provider

  let updated
  for (let logicalId in Resources) {
    fn({
      id: logicalId,
      resource: Resources[logicalId]
    })
  }

  // fn({
  //   id: 'ServerlessDeploymentBucket',
  //   resource: {
  //     Type: 'AWS::S3::Bucket'
  //   }
  // })

  // fn({
  //   id: 'ApiGatewayRestApi',
  //   resource: {
  //     Type: 'AWS::ApiGateway::RestApi'
  //   }
  // })
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

  environment.STACK_ID = {
    Ref: 'AWS::StackId'
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

function addResourcesToOutputs (yaml) {
  const { resources } = yaml
  if (!resources.Outputs) resources.Outputs = {}

  const { Outputs } = resources
  forEachResource(yaml, ({ id, resource }) => {
    if (id in Outputs) {
      throw new Error(`refusing to overwrite Outputs.${id}`)
    }

    const output = Outputs[id] = {}
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
