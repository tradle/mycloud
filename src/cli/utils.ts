import path from 'path'
import _ from 'lodash'
import promisify from 'pify'
import proc from 'child_process'
import { parseSync as parseEnv } from 'env-file-parser'
import _fs from 'fs'
import readline from 'readline'
import YAML from 'js-yaml'
import yn from 'yn'
import getLocalIP from 'localip'
import isNative from 'is-native-module'
import AWS from 'aws-sdk'
import execa from 'execa'

import { Bucket } from '../bucket'
import Errors from '../errors'
import { Env } from '../env'
import { createRemoteBot } from '../'
import { createConf } from '../in-house-bot/configure'
import {
  Bot
} from '../in-house-bot/types'

import * as compile from './compile'
import { resources as ResourceDefs } from './resources'
import { createConfig } from '../aws-config'
import { isLocalUrl, allSettled } from '../utils'
import { createUtils as createS3Utils } from '../s3-utils'
import { consoleLogger } from '../logger'

const Localstack = require('../test/localstack')
const debug = require('debug')('tradle:sls:cli:utils')
const copy = promisify(require('copy-dynamodb-table').copy)

const pexec = promisify(proc.exec.bind(proc))
const fs = promisify(_fs)

const getStackName = () => {
  const {
    service,
    provider: { stage }
  } = require('./serverless-yml')

  return `${service}-${stage}`
}

const getRegion = () => require('./serverless-yml').provider.region

const getStackResources = ({ bot, stackName }: {
  bot: Bot
  stackName: string
}) => {
  return bot.stackUtils.getStackResources(stackName || getStackName())
}

const getPhysicalId = async ({ bot, logicalId }) => {
  const resources = await getStackResources({
    bot,
    stackName: getStackName()
  })

  const match = resources.find(({ LogicalResourceId }) => LogicalResourceId === logicalId)
  if (!match) {
    const list = resources.map(({ LogicalResourceId }) => LogicalResourceId)
    throw new Error(`resource with logical id "${logicalId}" not found. See list of resources in stack: ${JSON.stringify(list)}`)
  }

  return match.PhysicalResourceId
}

const removeLocalBucket = async ({ bucket, endpoint }) => {
  if (!isLocalUrl(endpoint)) {
    throw new Error('expected "endpoint" on localhost')
  }

  if (!bucket) {
    throw new Error('expected string "bucket"')
  }

  try {
    await execa.shell(`aws --endpoint ${endpoint} s3 rb "s3://${bucket}" --force`)
  } catch (err) {
    throw new Error(`failed to delete bucket ${bucket}: ${err.message}`)
  }
}

const nukeLocalResources = async ({ region, stackName }: {
  region: string
  stackName: string
}) => {
  const config = createConfig({ region, local: true })
  const dynamodb = new AWS.DynamoDB(config.dynamodb)
  const s3 = new AWS.S3(config.s3)
  const delTables = async () => {
    const tables = await dynamodb.listTables().promise()
    const stackTables = tables.TableNames
      .filter(t => t.startsWith(`${stackName}-`))

    await Promise.all(stackTables.map(TableName => dynamodb.deleteTable({ TableName }).promise()))
  }

  const delBuckets = async () => {
    const buckets = await s3.listBuckets().promise()
    const stackBuckets = buckets.Buckets
      .map(b => b.Name)
      .filter(b => b.startsWith(`${stackName}-`))

    await Promise.all(stackBuckets.map(bucket => removeLocalBucket({ endpoint: s3.config.endpoint, bucket })))
  }

  await Promise.all([
    delTables(),
    delBuckets()
  ])
}

const getLocalResourceName = ({ stackName, name }: {
  stackName: string
  name: string
}) => {
  name = name.toLowerCase()
  if (name === 'bucket0') name = 'bucket-0'

  return `${stackName}-${name}`
}

const genLocalResources = async ({ region, stackName }: {
  region: string
  stackName: string
}) => {

  const config = createConfig({ region, local: true })
  const dynamodb = new AWS.DynamoDB(config.dynamodb)
  const s3 = new AWS.S3(config.s3)
  const promiseTables = Promise.all(_.map(ResourceDefs.tables, async ({ Properties }, name: string) => {
    if (Properties.StreamSpecification) {
      Properties.StreamSpecification.StreamEnabled = true
    }

    delete Properties.TimeToLiveSpecification
    delete Properties.PointInTimeRecoverySpecification
    delete Properties.SSESpecification

    Properties.TableName = getLocalResourceName({ stackName, name })
    try {
      await dynamodb.createTable(Properties).promise()
    } catch (err) {
      Errors.ignore(err, { name: 'ResourceInUseException' })
    }
  }))

  const promiseBuckets = Promise.all(_.map(ResourceDefs.buckets, async ({ Properties }, name: string) => {
    const params = {
      // not the real bucket name
      Bucket: getLocalResourceName({ stackName, name }),
    }

    await s3.createBucket(params).promise()
  }))

  await Promise.all([
    promiseTables,
    promiseBuckets
  ])
}

const makeDeploymentBucketPublic = async () => {
  loadCredentials()

  const { buckets } = createRemoteBot()
  await buckets.ServerlessDeployment.makePublic()
}

const interpolateTemplate = (opts:{ arg?:string, sync?:boolean }={}) => {
  const { arg='', sync } = opts
  const command = `sls print ${arg}`
  if (sync) {
    return Promise.resolve(proc.execSync(command).toString())
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

const alphaNumRegex = /^[a-zA-Z][a-zA-Z0-9]+$/
const stackNameRegex = /^tdl-[a-zA-Z0-9-]+-ltd$/

const compileTemplate = async (path) => {
  const file = await fs.readFile(path, { encoding: 'utf8' })
  const yml = YAML.safeLoad(file)
  const exists = fs.existsSync('./serverless.yml')
  if (!exists) {
    await fs.writeFile('./serverless.yml', file, { encoding: 'utf8' })
  }

  const interpolatedStr = await interpolateTemplate()
  const interpolated = YAML.safeLoad(interpolatedStr)
  if (!stackNameRegex.test(interpolated.service)) {
    throw new Error(`invalid "service" name "${interpolated.service}", adhere to regex: ${stackNameRegex}`)
  }

  if (!alphaNumRegex.test(interpolated.provider.stage)) {
    throw new Error(`invalid stage "${interpolated.provider.stage}", adhere to regex: ${alphaNumRegex}`)
  }

  // validateProviderConf(interpolated.custom.providerConf)
  // compile.addBucketTables({ yml, prefix: interpolated.custom.prefix })
  // setBucketEncryption({ target: yml, interpolated })
  compile.stripDevFunctions(yml)
  // addCustomResourceDependencies(yml, interpolated)

  const IS_LOCAL = process.env.IS_LOCAL
  if (IS_LOCAL) {
    compile.removeResourcesThatDontWorkLocally(yml)
  }

  // compile.addResourcesToEnvironment(yml)
  // compile.addResourcesToOutputs(yml)
  compile.addLogProcessorEvents(yml)
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
  _.extend(process.env, getRemoteEnv())
  // const { env } = require('../env').tradle
  // env.set(getRemoteEnv())
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

// const validateProviderConf = conf => {
//   const { style } = conf
//   if (style) {
//     validateResource.resource({
//       models,
//       resource: style
//     })
//   }
// }

const downloadDeploymentTemplate = async (bot:Bot) => {
  return await bot.stackUtils.getStackTemplate()
}

// const initStack = async (opts:{ bot?: Bot, force?: boolean }={}) => {
//   let { bot, force } = opts
//   if (!bot) {
//     const { createBot } = require('../')
//     bot = createBot()
//   }

//   const conf = createConf({ bot })
//   if (!force) {
//     try {
//       const current = await conf.get()
//       const { info, botConf } = current
//       if (info && botConf) {
//         console.log('already initialized')
//         return
//       }
//     } catch (err) {}
//   }

//   // const providerConf = require('../in-house-bot/conf/provider')
//   const yml = require('./serverless-yml')
//   const providerConf = yml.custom.org
//   try {
//     await conf.initInfra(providerConf, {
//       forceRecreateIdentity: force
//     })
//   } catch (err) {
//     Errors.ignore(err, Errors.Exists)
//     console.log('prevented overwrite of existing identity/keys')
//   }
// }

const cloneRemoteTable = async ({ source, destination }) => {
  loadCredentials()

  const AWS = require('aws-sdk')
  const yml = require('./serverless-yml')
  const localCredentials = parseEnv(path.resolve(__dirname, '../../docker/.env'))
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

export const getOfflinePort = (env?:Env) => {
  if (env && env.SERVERLESS_OFFLINE_PORT) {
    return env.SERVERLESS_OFFLINE_PORT
  }

  const yml = require('./serverless-yml')
  return yml.custom['serverless-offline'].port
}

export const getOfflineHost = (env?:Env) => {
  if (env && env.SERVERLESS_OFFLINE_APIGW) {
    return env.SERVERLESS_OFFLINE_APIGW
  }

  const port = getOfflinePort(env)
  return `http://${getLocalIP()}:${port}`
}

export const confirm = async (question?: string) => {
  if (question) console.warn(question)

  const rl = readline.createInterface(process.stdin, process.stdout)
  const answer = await new Promise(resolve => {
    rl.question('continue? y/[n]:', resolve)
  })

  rl.close()
  return yn(answer)
}

export const validateTemplateAtPath = async ({ cloudformation, templatePath }: {
  cloudformation: AWS.CloudFormation
  templatePath: string
}) => {
  const TemplateBody = await fs.readFile(templatePath, { encoding: 'utf8' })
  await cloudformation.validateTemplate({ TemplateBody }).promise()
}

const getTemplatesFilePaths = (dir: string) => fs.readdirSync(dir)
  .filter(file => /\.(ya?ml|json)$/.test(file))
  .map(file => path.resolve(dir, file))

export const validateTemplatesAtPath = async ({ cloudformation, dir }: {
  cloudformation: AWS.CloudFormation
  dir: string
}) => {
  const files = getTemplatesFilePaths(dir)
  const results = await allSettled(files.map(templatePath => validateTemplateAtPath({ cloudformation, templatePath })))
  const errors = results.map((result, i) => result.isRejected && {
    template: files[i],
    error: result.reason
  })
  .filter(_.identity)

  if (errors.length) {
    throw new Error(JSON.stringify(errors))
  }
}

export const uploadTemplatesAtPath = async ({ s3, dir, bucket, prefix, acl }: {
  s3: AWS.S3
  dir: string
  bucket: string
  prefix: string
  acl?: AWS.S3.ObjectCannedACL
}) => {
  const files = getTemplatesFilePaths(dir)
  const params:AWS.S3.PutObjectRequest = {
    Bucket: bucket,
    Key: null,
    Body: null,
    ACL: acl,
  }

  await Promise.all(files.map(async file => {
    const template = YAML.safeLoad(await fs.readFile(file))
    const key = path.basename(file).replace(/\.ya?ml$/, '.json')
    return s3.putObject({
      ...params,
      Key: `${prefix}/${key}`,
      Body: new Buffer(JSON.stringify(template)),
      ContentType: 'application/json',
    }).promise()
  }))
}

export {
  getRemoteEnv,
  loadRemoteEnv,
  compileTemplate,
  interpolateTemplate,
  genLocalResources,
  nukeLocalResources,
  makeDeploymentBucketPublic,
  loadCredentials,
  getRegion,
  getLocalResourceName,
  getStackName,
  getStackResources,
  getPhysicalId,
  getNativeModules,
  getProductionModules,
  downloadDeploymentTemplate,
  // initStack,
  cloneRemoteTable,
  cloneRemoteBucket
}
