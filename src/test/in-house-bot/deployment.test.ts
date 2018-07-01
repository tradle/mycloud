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

const users = require('../fixtures/users.json')
const { loudAsync } = utils

test('deployment by referral', loudAsync(async (t) => {
  const sandbox = sinon.createSandbox()
  const configuredBy = users[0].identity
  const senderEmail = 'sender@example.com'
  const conf = {
    ...fake({
      models,
      model: models['tradle.cloud.Configuration'],
      signed: true
    }),
    name: 'myorg',
    domain: 'example.com',
    adminEmail: 'admin@example.com',
    hrEmail: 'hr@example.com',
    stackPrefix: 'mytradle'
  }

  conf._author = users[0].link

  const parent = createTestBot()
  const child = createTestBot()
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
  const kv = {}
  sandbox.stub(parent, 'getPermalink').resolves('abc')
  const sendStub = sandbox.stub(parent, 'send').resolves({})

  sandbox.stub(parentDeployment.kv, 'put').callsFake(async (key, value) => {
    t.equal(value.link, conf._link)
    kv[key] = value
  })

  sandbox.stub(parentDeployment.kv, 'get').callsFake(async (key) => {
    if (kv[key]) return kv[key]

    throw new Errors.NotFound(key)
  })

  let deploymentConf: IMyDeploymentConf
  let expectedLaunchReport
  let pubConfStub = sandbox.stub(parent.buckets.PrivateConf, 'putJSON').callsFake(async (key, val) => {
    deploymentConf = {
      stackId: child.stackUtils.thisStackId,
      ...val.Mappings.deployment.init,
      ...val.Mappings.org.init,
      name: 'myorg',
      domain: 'mydomain',
      identity: childIdentity,
      apiUrl: childUrl
    }

    expectedLaunchReport = {
      ..._.omit(deploymentConf, ['name', 'domain', 'referrerUrl', 'stage', 'service', 'stackName', 'logo']),
      org: _.pick(deploymentConf, ['name', 'domain'])
    }
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

  const launchTemplate = await parentDeployment.genLaunchTemplate({
    name: 'testo',
    domain: 'testo.test',
    logo: 'somewhere/somelogo.png',
    region: 'ap-southeast-2',
    configurationLink: conf._link,
    stackPrefix: conf.stackPrefix,
    adminEmail: conf.adminEmail
  })

  // t.equal(launchTemplate.template.Resources.AwsAlertsAlarm.Properties.Subscription[0].Endpoint, conf.adminEmail)
  t.equal(launchTemplate.template.Mappings.org.contact.adminEmail, conf.adminEmail)
  // t.same(launchTemplate.template.Resources.AwsAlertsAlarm.Properties.Subscription[0].Endpoint, {
  //   'Fn::FindInMap': ['org', 'contact', 'adminEmail']
  // })

  const launchUrl = launchTemplate.url

  let childDeploymentResource
  const saveChildDeploymentStub = sandbox.stub(parent.db, 'put').callsFake(async (res) => {
    childDeploymentResource = res
  })

  const getConfAuthorStub = sandbox.stub(parent.identities, 'byPermalink').callsFake(async (permalink) => {
    if (permalink === conf._author) {
      return configuredBy
    }

    throw new Errors.NotFound(permalink)
  })

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
  t.equal(saveChildDeploymentStub.callCount, 1)
  t.equal(childDeploymentResource.deploymentUUID, deploymentConf.deploymentUUID)

  sandbox.stub(parent.db, 'findOne').resolves(childDeploymentResource)

  pubConfStub.restore()
  pubConfStub = sandbox.stub(parent.buckets.PrivateConf, 'putJSON').callsFake(async (key, template) => {
    t.equal(template.Mappings.org.contact.adminEmail, conf.adminEmail)
  })

  const { url } = await parentDeployment.createUpdate({
    createdBy: childIdentity._permalink
  })

  // console.log(parentDeployment.genLaunchEmailBody({ launchUrl }))
  // console.log('OIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIO')
  // console.log(parentDeployment.genLaunchedEmailBody({ launchUrl }))

  t.equal(pubConfStub.callCount, 1)
  sandbox.restore()
  t.end()
}))
