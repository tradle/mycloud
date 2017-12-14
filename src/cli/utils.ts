const path = require('path')
const promisify = require('pify')
const proc = require('child_process')
const pexec = promisify(proc.exec.bind(proc))
const parseEnv = require('env-file-parser').parseSync
const fs = promisify(require('fs'))
const YAML = require('js-yaml')
const isNative = require('is-native-module')
const extend = require('xtend/mutable')
const pick = require('object.pick')
const debug = require('debug')('tradle:sls:cli:utils')
const { models } = require('@tradle/models')
const validateResource = require('@tradle/validate-resource')
const { TYPE } = require('@tradle/constants')
const prettify = obj => JSON.stringify(obj, null, 2)
const { Bucket } = require('../bucket')
const Errors = require('../errors')
const Localstack = require('../test/localstack')
const copy = promisify(require('copy-dynamodb-table').copy)

const {
  addResourcesToEnvironment,
  addResourcesToOutputs,
  removeResourcesThatDontWorkLocally,
  addBucketTables,
  stripDevFunctions
} = require('./compile')

const getStackName = () => {
  const {
    service,
    provider: { stage }
  } = require('./serverless-yml')

  return `${service}-${stage}`
}

const getStackResources = ({ tradle, stackName }) => {
  return tradle.lambdaUtils.getStackResources(stackName || getStackName())
}

const getPhysicalId = async ({ tradle, logicalId }) => {
  const resources = await getStackResources({
    tradle,
    stackName: getStackName()
  })

  const match = resources.find(({ LogicalResourceId }) => LogicalResourceId === logicalId)
  if (!match) {
    const list = resources.map(({ LogicalResourceId }) => LogicalResourceId)
    throw new Error(`resource with logical id "${logicalId}" not found. See list of resources in stack: ${JSON.stringify(list)}`)
  }

  return match.PhysicalResourceId
}

const genLocalResources = async ({ tradle }) => {
  if (!tradle) {
    tradle = require('../').createTestTradle()
  }

  const { aws } = tradle
  const { s3 } = aws
  const yml = require('./serverless-yml')
  const { resources } = yml
  const { Resources } = resources
  const togo = {}
  const tables = []
  const buckets = []

  let numCreated = 0
  Object.keys(Resources)
    .filter(name => Resources[name].Type === 'AWS::DynamoDB::Table')
    .forEach(name => {
      const { Type, Properties } = Resources[name]
      if (Properties.StreamSpecification) {
        Properties.StreamSpecification.StreamEnabled = true
      }

      togo[name] = true
      tables.push(
        aws.dynamodb.createTable(Properties).promise()
          .then(result => {
            delete togo[name]
            debug(`created table: ${name}`)
            debug('waiting on', togo)
            numCreated++
          })
          .catch(err => {
            if (err.name !== 'ResourceInUseException') {
              throw err
            }
          })
      )
    })

  const currentBuckets = await aws.s3.listBuckets().promise()
  Object.keys(Resources)
    .filter(name => Resources[name].Type === 'AWS::S3::Bucket')
    .forEach(name => {
      const Bucket = tradle.prefix + name.toLowerCase()
      const exists = currentBuckets.Buckets.find(({ Name }) => {
        return Name === Bucket
      })

      if (exists) return

      togo[name] = true
      buckets.push(
        aws.s3.createBucket({ Bucket })
        .promise()
        .then(result => {
          numCreated++
          delete togo[name]
          debug(`created bucket: ${name}`)
          debug('waiting on', togo)
        })
      )
    })

  const promises = buckets.concat(tables)
  debug(`waiting for resources...`)
  await Promise.all(promises)
  debug('resources created!')
  return numCreated
}

const makeDeploymentBucketPublic = async () => {
  loadCredentials()

  const { s3 } = require('../').tradle.aws
  const serverlessYml = require('./serverless-yml')
  const { service, custom } = serverlessYml
  const { Buckets } = await s3.listBuckets().promise()
  const Bucket = Buckets.find(bucket => {
    return new RegExp(`${service}-${custom.stage}-serverlessdeploymentbucket`)
      .test(bucket.Name)
  }).Name

  await makePublic(Bucket)
}

const makePublic = async (Bucket) => {
  loadCredentials()

  const { s3 } = require('../').tradle.aws
  await s3.putBucketPolicy({
    Bucket,
    Policy: `{
      "Version": "2012-10-17",
      "Statement": [{
        "Sid": "MakeItPublic",
        "Effect": "Allow",
        "Principal": "*",
        "Action": "s3:GetObject",
        "Resource": "arn:aws:s3:::${Bucket}/*"
      }]
    }`
  }).promise()

  // await s3.putBucketAcl({
  //   Bucket,
  //   ACL: 'public-read'
  // }).promise()
}

const interpolateTemplate = (opts={}) => {
  const { arg='', sync } = opts
  const command = `sls print ${arg}`
  if (sync) {
    return proc.execSync(command).toString()
  }

  return new Promise((resolve, reject) => {
    proc.exec(command, {
      cwd: process.cwd()
    }, function (err, stdout, stderr) {
      if (err) {
        reject(new Error(stderr || stdout || err.message))
      } else {
        resolve(stdout.toString())
      }
    })
  })
}

const compileTemplate = async (path) => {
  const file = await fs.readFile(path, { encoding: 'utf8' })
  const yml = YAML.safeLoad(file)
  const exists = fs.existsSync('./serverless.yml')
  if (!exists) {
    await fs.writeFile('./serverless.yml', file, { encoding: 'utf8' })
  }

  const interpolatedStr = await interpolateTemplate()
  const interpolated = YAML.safeLoad(interpolatedStr)
  validateProviderConf(interpolated.custom.providerConf)
  addBucketTables({ yml, prefix: interpolated.custom.prefix })
  stripDevFunctions(yml)

  const isLocal = process.env.IS_LOCAL
  if (isLocal) {
    removeResourcesThatDontWorkLocally(yml)
  }

  addResourcesToEnvironment(yml)
  addResourcesToOutputs(yml)
  return YAML.dump(yml)
}

function loadCredentials () {
  const AWS = require('aws-sdk')
  const yml = require('./serverless-yml')
  const { profile } = yml.provider
  AWS.config.credentials = new AWS.SharedIniFileCredentials({ profile })
}

function getRemoteEnv () {
  return require('./remote-service-map')
}

function loadRemoteEnv () {
  const { env } = require('../').tradle
  env.set(getRemoteEnv())
}

// borrowed gratefully from https://github.com/juliangruber/native-modules
const getNativeModules = async (dir='node_modules', modules={}) => {
  const lstat = await fs.lstat(dir)
  if (!lstat.isDirectory()) return

  const name = dir.split('node_modules').pop()
  if (name in modules) return

  const files = await fs.readdir(dir)
  const promiseOne = fs.readFile(`${dir}/package.json`)
    .then(json => {
      const pkg = JSON.parse(json.toString('utf8'))
      if (isNative(pkg)) modules[pkg.name] = true
    }, err => {
      if (err.code !== 'ENOENT') throw err
    })

  const nested = files
    .filter(f => !/^\./.test(f))
    .map(f => getNativeModules(`${dir}/${f}`, modules))

  await Promise.all(nested.concat(promiseOne))
  return Object.keys(modules)
}

const getProductionModules = async () => {
  const command = 'npm ls --production --parseable=true --long=false --silent'
  const buf = await pexec(command, {
    cwd: process.cwd()
  })

  return buf.toString()
    .split('\n')
    .map(path => {
      return {
        path,
        name: path.split('node_modules/').pop()
      }
    })
}

const getTableDefinitions = () => {
  const yml = require('./serverless-yml')
  const { Resources } = yml.resources
  const tableNames = Object.keys(Resources)
    .filter(name => Resources[name].Type === 'AWS::DynamoDB::Table')

  const map = {}
  for (const name of tableNames) {
    map[name] = Resources[name]
  }

  return map
}

const validateProviderConf = conf => {
  const { style } = conf.public
  if (style) {
    validateResource({
      models,
      resource: style
    })
  }
}

const downloadDeploymentTemplate = async (tradle) => {
  loadCredentials()

  const { aws, s3Utils } = tradle
  const { service, provider: { stage } } = require('./serverless-yml')
  const artifactDirectoryPrefix = `serverless/${service}/${stage}`
  const templateFileName = 'compiled-cloudformation-template.json'
  const physicalId = await getPhysicalId({
    tradle,
    logicalId: 'ServerlessDeploymentBucket'
  })

  const objects = await aws.s3.listObjects({
    Bucket: physicalId,
    Prefix: artifactDirectoryPrefix
  }).promise()

  const templates = objects.Contents
    .filter(object => object.Key.endsWith(templateFileName))

  const metadata = getLatestS3Object(templates)
  if (!metadata) {
    debug('base template not found', prettify(objects))
    return
  }

  debug('base template', `https://${physicalId}.s3.amazonaws.com/${metadata.Key}`)
  return await s3Utils.getJSON({
    bucket: physicalId,
    key: metadata.Key
  })
}

function getLatestS3Object (list) {
  let max = 0
  let latest
  for (let metadata of list) {
    let date = new Date(metadata.LastModified).getTime()
    if (date > max) latest = metadata
  }

  return latest
}

const clearTypes = async ({ tradle, types }) => {
  const { dbUtils } = tradle
  const { getModelMap, clear } = dbUtils
  const modelMap = getModelMap({ types })

  let deleteCounts = {}
  const buckets = []
  types.forEach(id => {
    const bucketName = modelMap.models[id]
    if (!buckets.includes(bucketName)) {
      buckets.push(bucketName)
    }
  })

  console.log('deleting items from buckets:', buckets.join(', '))
  await Promise.all(buckets.map(async (TableName) => {
    const { KeySchema } = await dbUtils.getTableDefinition(TableName)
    const keyProps = KeySchema.map(({ AttributeName }) => AttributeName)
    const processOne = async (item) => {
      const type = item[TYPE]
      if (!types.includes(item[TYPE])) return

      const Key = pick(item, keyProps)
      while (true) {
        try {
          console.log('deleting item', Key, 'from', TableName)
          await dbUtils.del({ TableName, Key })
          break
        } catch (err) {
          const { name } = err
          if (!(name === 'ResourceNotFoundException' || name === 'LimitExceededException')) {
            throw err
          }

          console.log('failed to delete item, will retry', err.name)
        }
      }

      if (!deleteCounts[TableName]) {
        deleteCounts[TableName] = {}
      }

      if (deleteCounts[TableName][type]) {
        deleteCounts[TableName][type]++
      } else {
        deleteCounts[TableName][type] = 1
      }
    }

    await dbUtils.batchProcess({
      params: { TableName },
      processOne
    })
  }))

  return deleteCounts
}

const initializeProvider = async (opts={}) => {
  let { bot, force } = opts
  if (!bot) {
    const { createBot } = require('../bot')
    bot = createBot()
  }

  bot.ready()

  const { Init } = require('../samplebot/init')
  const init = new Init({ bot })
  const providerConf = require('../samplebot/conf/provider')
  const { org } = providerConf.private
  try {
    await init.init({
      force,
      private: { org }
    })
  } catch (err) {
    Errors.ignore(err, Errors.Exists)
    console.log('prevented overwrite of existing identity/keys')
  }
}

const cloneRemoteTable = async ({ source, destination }) => {
  loadCredentials()

  const AWS = require('aws-sdk')
  const yml = require('./serverless-yml')
  const localCredentials = parseEnv(path.resolve(__dirname, '../../docker/.env'))
  const destinationAWSConfig = {
    accessKeyId: localCredentials.AWS_ACCESS_KEY_ID,
    secretAccessKey: localCredentials.AWS_SECRET_ACCESS_KEY
  }

  const { region } = yml.provider
  await copy({
    config: {
      region
    },
    source: {
      tableName: source,
      dynamoClient: new AWS.DynamoDB.DocumentClient({ region })
    },
    destination: {
      tableName: destination, // required
      dynamoClient: new AWS.DynamoDB.DocumentClient({
        region,
        endpoint: Localstack.DynamoDB
      })
    },
    log: true
  })
}

const alwaysTrue = (...any) => true
const cloneRemoteBucket = async ({ source, destination, filter=alwaysTrue }) => {
  loadCredentials()

  const AWS = require('aws-sdk')
  const sourceBucket = new Bucket({
    name: source,
    s3: new AWS.S3()
  })

  const destinationS3 = new AWS.S3({
    endpoint: Localstack.S3,
    s3ForcePathStyle: true
  })

  await sourceBucket.forEach({
    getBody: true,
    map: batch => {
      const keep = batch.filter(filter)
      console.log(`processing batch of ${keep.length} items`)
      return Promise.all(keep.map(async (item) => {
        return destinationS3.putObject({
          Key: item.Key,
          Bucket: destination,
          Body: item.Body,
          ContentType: item.ContentType
        }).promise()
      }))
    }
  })
}

module.exports = {
  getRemoteEnv,
  loadRemoteEnv,
  compileTemplate,
  interpolateTemplate,
  genLocalResources,
  makeDeploymentBucketPublic,
  loadCredentials,
  getStackName,
  getStackResources,
  getPhysicalId,
  getNativeModules,
  getProductionModules,
  getTableDefinitions,
  downloadDeploymentTemplate,
  clearTypes,
  initializeProvider,
  cloneRemoteTable,
  cloneRemoteBucket
}
