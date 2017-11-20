const debug = require('debug')('tradle:sls:deployment-bot')
const clone = require('clone')
const omit = require('object.omit')
const { parseStub } = require('@tradle/validate-resource').utils
const { TYPE } = require('@tradle/constants')
const { prettify } = require('../string-utils')
// const ServerlessDeployment = require('../s3-utils').getBucket('tradle-dev-serverlessdeploymentbucket-nnvi6x6tiv7k')
// const PublicConf = require('../s3-utils').getBucket('tradle-dev-PublicConfBucket-gd70s2lfklji')
const { getFaviconURL, getLogoDataURI } = require('./image-utils')
const utils = require('../utils')
const templateFileName = 'compiled-cloudformation-template.json'
const MIN_SCALE = 1
const MAX_SCALE = 1

export default function createDeploymentHandlers ({ bot, deploymentModels }) {
  const {
    // SERVERLESS_STAGE='dev',
    // SERVERLESS_SERVICE_NAME='tradle',
    SERVERLESS_STAGE,
    SERVERLESS_SERVICE_NAME
  } = bot.env

  const artifactDirectoryPrefix = `serverless/${SERVERLESS_SERVICE_NAME}/${SERVERLESS_STAGE}`
  const CONFIG_FORM = deploymentModels.configuration.id
  const DEPLOYMENT_PRODUCT = deploymentModels.deployment.id

  const getBaseTemplate = (function () {
    let baseTemplate
    if (process.env.IS_OFFLINE || process.env.IS_LOCAL) {
      baseTemplate = require('../../.serverless/cloudformation-template-update-stack')
      return async () => baseTemplate
    }

    return async ({ s3, resources }) => {
      const { ServerlessDeployment } = resources.buckets
      if (!baseTemplate) {
        const objects = await s3.listObjects({
          Bucket: ServerlessDeployment.id,
          // Bucket: 'tradle-dev-serverlessdeployment-nnvi6x6tiv7k',
          Prefix: artifactDirectoryPrefix
        }).promise()

        const templates = objects.Contents
          .filter(object => object.Key.endsWith(templateFileName))

        const metadata = latestS3Object(templates)
        if (!metadata) {
          debug('base template not found', prettify(objects))
          return
        }

        baseTemplate = await ServerlessDeployment.getJSON(metadata.Key)
      }

      return baseTemplate
    }
  }())

  function normalizeParameters (parameters) {
    parameters = clone(parameters)
    let scale = Math.round(parameters.scale)

    if (scale < MIN_SCALE) scale = MIN_SCALE
    if (scale > MAX_SCALE) scale = MAX_SCALE

    parameters.scale = scale
    return parameters
  }

  const writeTemplate = async ({ s3, resources, parameters }) => {
    const template = await getBaseTemplate({ s3, resources })
    const customized = generateTemplate({ resources, template, parameters })
    const templateKey = `templates/scale-${parameters.scale}.json`
    const { PublicConf } = resources.buckets
    try {
      await s3.putObject({
        Bucket: PublicConf.id,
        Key: templateKey,
        Body: JSON.stringify(customized),
        ACL: 'public-read'
      })
      .promise()
    } catch (err) {
      debug('failed to save template', err.stack)
    }

    return templateKey
  }

  const onForm = async ({ bot, user, type, wrapper, currentApplication }) => {
    if (type !== CONFIG_FORM) return
    if (!currentApplication || currentApplication.requestFor !== DEPLOYMENT_PRODUCT) return

    const { object } = wrapper.payload
    const { domain } = object
    try {
      await getLogoDataURI(domain)
    } catch (err) {
      const message = `couldn't process your logo!`
      await bot.requestEdit({
        user,
        object,
        message,
        errors: [
          {
            name: 'domain',
            error: message
          }
        ]
      })
    }
  }

  const onFormsCollected = async ({ user, application }) => {
    if (application.requestFor !== DEPLOYMENT_PRODUCT) return

    const latest = application.forms.slice().reverse().find(stub => {
      return parseStub(stub).type === CONFIG_FORM
    })

    const form = await bot.objects.get(parseStub(latest).link)
    const parameters = normalizeParameters(form)
    // parameters.logo = await getFaviconURL(parameters.domain)
    const templateKey = await writeTemplate({
      s3: bot.aws.s3,
      resources: bot.resources,
      parameters
    })

    const { PublicConf } = bot.resources.buckets
    const templateURL = PublicConf.getUrlForKey(templateKey)
    const launchURL = utils.launchStackUrl({
      stackName: 'tradle',
      templateURL
    })

    debug(`Launch your stack: ${launchURL}`)

    await bot.send({
      to: user.id,
      // object: `Launch your Tradle stack\n**${launchURL}**`
      object: {
        [TYPE]: 'tradle.SimpleMessage',
        message: `**[Launch MyCloud](${launchURL})**`
        // message: '**Launch MyCloud**'
      }
    })
  }


  return {
    onFormsCollected
  }
}

function getLambdaEnv (lambda) {
  return lambda.Properties.Environment.Variables
}

function generateTemplate ({ resources, template, parameters }) {
  const { name, scale, domain } = parameters
  template.Description = `MyCloud, by Tradle`

  const namespace = domain.split('.').reverse().join('.')
  const { Resources } = template
  Resources.Initialize.Properties.ProviderConf.org = { name, domain }

  const deploymentBucketId = resources.buckets.ServerlessDeployment.id
  for (let key in Resources) {
    let Resource = Resources[key]
    let { Type } = Resource
    switch (Type) {
    case 'AWS::DynamoDB::Table':
      debug(`scaling ${Type} ${Resource.Properties.TableName}`)
      scaleTable({ table: Resource, scale })
      break
    case 'AWS::Lambda::Function':
      // resolve Code bucket
      Resource.Properties.Code.S3Bucket = deploymentBucketId
      break
    default:
      break
    }
  }

  // write template to s3, return link
  return template
}

function scaleTable ({ table, scale }) {
  let { ProvisionedThroughput } = table.Properties
  ProvisionedThroughput.ReadCapacityUnits *= scale
  ProvisionedThroughput.WriteCapacityUnits *= scale
  const { GlobalSecondaryIndexes=[] } = table
  GlobalSecondaryIndexes.forEach(index => scaleTable({ table: index, scale }))
}

function last (arr) {
  return arr[arr.length - 1]
}

function latestS3Object (list) {
  let max = 0
  let latest
  for (let metadata of list) {
    let date = new Date(metadata.LastModified).getTime()
    if (date > max) latest = metadata
  }

  return latest
}
