require('../env').install()

import querystring from 'querystring'
import _ from 'lodash'
import test from 'tape'
import sinon from 'sinon'
import { TYPE, SIG, OWNER } from '@tradle/constants'
import fake from '@tradle/build-resource/fake'
import buildResource from '@tradle/build-resource'
import { Deployment } from '../../in-house-bot/deployment'
import * as utils from '../../utils'
import Errors from '../../errors'
import { createTestBot } from '../../'
import { TYPES, PRIVATE_CONF_BUCKET } from '../../in-house-bot/constants'
import models from '../../models'
import { IMyDeploymentConf, IBotConf, ILaunchReportPayload, IConf } from '../../in-house-bot/types'
import { createTestEnv } from '../env'
import { S3Utils } from '../../s3-utils'

const users = require('../fixtures/users.json')
const { loudAsync } = utils

test('deployment by referral', loudAsync(async (t) => {
  const sandbox = sinon.createSandbox()
  const configuredBy = users[0].identity
  const senderEmail = 'sender@example.com'
  const region = 'ap-southeast-2'
  const conf = {
    ...fake({
      models,
      model: models['tradle.cloud.Configuration'],
      signed: true
    }),
    region: Deployment.encodeRegion(region),
    name: 'myorg',
    domain: 'example.com',
    adminEmail: 'admin@example.com',
    hrEmail: 'hr@example.com',
    stackPrefix: 'mytradle',
  }

  conf._author = users[0].link

  const parent = createTestBot()
  const child = createTestBot({
    env: createTestEnv({
      AWS_REGION: region,
      R_STACK: parent.stackUtils.thisStackId.replace(parent.env.AWS_REGION, region)
    })
  })

  const childUrl = 'childurl'
  child.serviceMap.RestApi.ApiGateway.url = childUrl

  const parentDeployment = new Deployment({
    bot: parent,
    logger: parent.logger.sub('deployment:test:parent'),
    conf: { senderEmail },
    orgConf: <IConf>{
      org: {
        name: 'parent',
        domain: 'parent.io'
      }
    }
  })

  const childDeployment = new Deployment({
    bot: child,
    logger: child.logger.sub('deployment:test:child')
  })

  const childIdentity = await child.getMyIdentity()
  // const kv = {}
  sandbox.stub(parent, 'getPermalink').resolves('abc')
  const sendStub = sandbox.stub(parent, 'send').resolves({})

  // sandbox.stub(parentDeployment.kv, 'put').callsFake(async (key, value) => {
  //   t.equal(value.link, conf._link)
  //   kv[key] = value
  // })

  // sandbox.stub(parentDeployment.kv, 'get').callsFake(async (key) => {
  //   if (kv[key]) return kv[key]

  //   throw new Errors.NotFound(key)
  // })

  let deploymentConf: IMyDeploymentConf
  let expectedLaunchReport
  let saveTemplateStub = sandbox.stub(parentDeployment, 'savePublicTemplate').callsFake(async ({ template, bucket }) => {
    t.ok(bucket.endsWith(region))

    deploymentConf = {
      stackId: child.stackUtils.thisStackId,
      ...template.Mappings.deployment.init,
      ...template.Mappings.org.init,
      name: 'myorg',
      domain: 'mydomain',
      identity: childIdentity,
      apiUrl: childUrl
    }

    expectedLaunchReport = {
      ..._.omit(deploymentConf, ['name', 'domain', 'referrerUrl', 'stage', 'service', 'stackName', 'logo']),
      org: _.pick(deploymentConf, ['name', 'domain'])
    }

    return 'http://my.template.url'
  })

  const getTemplate = sandbox.stub(parent.stackUtils, 'getStackTemplate').resolves({
    "Mappings": {
      "org": {
        "init": {
          "name": "Tradle",
          "domain": "tradle.io",
          "logo": "https://tradle.io/images/logo256x.png"
        }
      },
      "deployment": {
        "init": {
          "referrerUrl": "",
          "referrerIdentity": "",
          "deploymentUUID": "",
          "service": "tdl-xxxx-tdl",
          "stage": "dev",
          "stackName": "tdl-xxxx-tdl-dev"
        }
      }
    },
    "Resources": {
      "Initialize": {
        "Properties": {}
      },
      "SomeLambdaFunction": {
        "Type": "AWS::Lambda::Function",
        "Properties": {
          "Code": {
            "S3Bucket": {
              "Ref": "ServerlessDeploymentBucket"
            },
            "S3Key": "path-to-lambda-code.zip"
          }
        }
      },
      // "AwsAlertsAlarm": {
      //   "Type": "AWS::SNS::Topic",
      //   "Properties": {
      //     "TopicName": "tdl-xxxx-ltd-dev-alerts-alarm",
      //     "Subscription": [
      //       {
      //         "Protocol": "email",
      //         "Endpoint": "someone@example.com"
      //       }
      //     ]
      //   }
      // }
    }
  })

  const copyFiles = sandbox.stub(parent.buckets.ServerlessDeployment, 'copyFilesTo').callsFake(async ({
    bucket,
    keys
  }) => {
    t.ok(bucket.endsWith(region))
    t.same(keys, ['path-to-lambda-code.zip'])
  })

  // const getTemplate = sandbox.stub(parent.stackUtils, 'getStackTemplate')
  //   .resolves(require('../../../.serverless/cloudformation-template-update-stack'))

  const getUserStub = sandbox.stub(parent.users, 'get').callsFake(async permalink => {
    if (permalink === conf._author) {
      return {
        id: conf._author,
        identity: configuredBy
      }
    }

    throw new Errors.NotFound(permalink)
  })

  const getStub = sandbox.stub(parent.objects, 'get').callsFake(async link => {
    if (link === conf._link) {
      return conf
    }

    if (link === childDeploymentResource._link) {
      return childDeploymentResource
    }

    throw new Errors.NotFound(link)
  })

  // sandbox.stub(bot.stackUtils, 'getStackTemplate').resolves({
  //   Mappings: {
  //     deployment: {},
  //     org: {}
  //   }
  // })

  const postStub = sandbox.stub(utils, 'post').callsFake(async (url, data) => {
    t.equal(url, parentDeployment.getReportLaunchUrl())
    t.equal(url, parentDeployment.getReportLaunchUrl(deploymentConf.referrerUrl))
    t.same(data, expectedLaunchReport)
    await parentDeployment.receiveLaunchReport(data)
  })

  const childLoadFriendStub = sandbox.stub(child.friends, 'load').callsFake(async ({ url }) => {
    t.equal(url, parent.apiBaseUrl)
  })

  const parentAddFriendStub = sandbox.stub(parent.friends, 'add').callsFake(async ({ url }) => {
    t.equal(url, childUrl)
    return {
      identity: buildResource.stub({ resource: childIdentity })
    }
  })

  const sentEmails = []
  const emailStub = sandbox.stub(parent.mailer, 'send').callsFake(async (opts) => {
    t.equal(opts.from, senderEmail)
    sentEmails.push(...opts.to)
  })

  const getConfAuthorStub = sandbox.stub(parent.identities, 'byPermalink').callsFake(async (permalink) => {
    if (permalink === conf._author) {
      return configuredBy
    }

    throw new Errors.NotFound(permalink)
  })

  let childDeploymentResource
  let topicResource
  const saveResourceStub = sandbox.stub(parent, 'save').callsFake(async resource => {
    if (resource[TYPE] === 'tradle.cloud.ChildDeployment') {
      childDeploymentResource = resource
    }

    return resource
  })

  const findChildDeployment = sandbox.stub(parentDeployment, 'getChildDeploymentByDeploymentUUID').callsFake(async deploymentUUID => {
    t.equal(deploymentUUID, childDeploymentResource.deploymentUUID)
    return childDeploymentResource
  })

  await parentDeployment.deleteRegionalDeploymentBuckets({
    regions: [region]
  })

  await parentDeployment.createRegionalDeploymentBuckets({
    regions: [region]
  })

  const launchPackage = await parentDeployment.genLaunchPackage({
    name: 'testo',
    domain: 'testo.test',
    logo: 'somewhere/somelogo.png',
    region,
    // configurationLink: conf._link,
    stackPrefix: conf.stackPrefix,
    adminEmail: conf.adminEmail,
    _t: 'tradle.cloud.Configuration',
    _author: conf._author,
    _link: conf._link,
    _permalink: conf._permalink,
  })

  t.equal(copyFiles.callCount, 1)
  // t.equal(launchPackage.template.Resources.AwsAlertsAlarm.Properties.Subscription[0].Endpoint, conf.adminEmail)
  t.equal(launchPackage.template.Mappings.org.contact.adminEmail, conf.adminEmail)
  // t.same(launchPackage.template.Resources.AwsAlertsAlarm.Properties.Subscription[0].Endpoint, {
  //   'Fn::FindInMap': ['org', 'contact', 'adminEmail']
  // })


  const launchUrl = launchPackage.url

  // const saveResourceStub = sandbox.stub(parent.db, 'put').callsFake(async (res) => {
  //   childDeploymentResource = res
  // })

  await childDeployment.reportLaunch({
    org: _.pick(deploymentConf, ['name', 'domain']),
    identity: childIdentity,
    referrerUrl: deploymentConf.referrerUrl,
    deploymentUUID: deploymentConf.deploymentUUID
  })

  // const { getObject } = parent.aws.s3
  // sandbox.stub(parent.aws.s3, 'getObject').callsFake(params => {
  //   const val = getObject.call(parent.aws.s3, params)
  //   if (params.Key === .PrivateConf.bot) {
  //     const promise = val.promise()
  //     sandbox.stub(val, 'promise').callsFake(async () => {
  //       return promise.then((conf: any) => {
  //         conf.products.plugins.deployment = { senderEmail }
  //         return conf
  //       })
  //     })
  //   }

  //   debugger
  //   return val
  // })

  await require('../../in-house-bot/lambda/http/deployment-pingback').handler({
    event: {
      url: child.apiBaseUrl,
      uuid: deploymentConf.deploymentUUID
    }
  }, {
    done: t.error
  }, t.error)

  await parentDeployment.notifyCreatorsOfChildDeployment(childDeploymentResource)

  t.equal(postStub.callCount, 1)
  t.same(sentEmails.sort(), [conf.adminEmail, conf.hrEmail].sort())
  t.equal(sendStub.getCall(0).args[0].to.id, conf._author)
  t.equal(parentAddFriendStub.callCount, 1)
  t.equal(childLoadFriendStub.callCount, 1)

  t.equal(saveResourceStub.callCount, 3)
  const [
    createTopic,
    createChild,
    updateChild,
  ] = saveResourceStub.getCalls().map(call => call.args[0])

  t.equal(createTopic[TYPE], 'tradle.cloud.TmpSNSTopic')
  t.equal(createChild[TYPE], 'tradle.cloud.ChildDeployment')
  t.equal(createChild.deploymentUUID, deploymentConf.deploymentUUID)
  t.equal(updateChild.apiUrl, childUrl)

  sandbox.stub(parent.db, 'findOne').resolves(childDeploymentResource)

  saveTemplateStub.callsFake(async ({ template, bucket }) => {
    t.ok(bucket.endsWith(region))
    t.equal(template.Mappings.org.contact.adminEmail, conf.adminEmail)
  })

  saveResourceStub.reset()

  const { url } = await parentDeployment.genUpdatePackage({
    createdBy: childIdentity._permalink
  })

  t.equal(copyFiles.callCount, 2)

  const [
    updateTopic,
  ] = saveResourceStub.getCalls().map(call => call.args[0])

  t.equal(updateTopic[TYPE], 'tradle.cloud.TmpSNSTopic')


  // console.log(parentDeployment.genLaunchEmailBody({ launchUrl }))
  // console.log('OIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIO')
  // console.log(parentDeployment.genLaunchedEmailBody({ launchUrl }))

  t.equal(saveTemplateStub.callCount, 2)

  // const deleteTmpSpy = sandbox.spy(parentDeployment, 'deleteTmpSNSTopic')
  // await parent.db.del(createTopic)
  // t.equal(deleteTmpSpy.callCount, 1)

  // await parentDeployment.deleteTmpSNSTopic(createTopic.topic)

  sandbox.restore()
  t.end()
}))
