require('../env').install()

import querystring = require('querystring')
import _ = require('lodash')
import test = require('tape')
import sinon = require('sinon')
import { TYPE, SIG, OWNER } from '@tradle/constants'
import fake = require('@tradle/build-resource/fake')
import buildResource = require('@tradle/build-resource')
import { Deployment } from '../../in-house-bot/deployment'
import * as utils from '../../utils'
import Errors = require('../../errors')
import { createBot } from '../../bot'
import { createTestTradle } from '../../'
import { TYPES, PRIVATE_CONF_BUCKET } from '../../in-house-bot/constants'
import models = require('../../models')
import { IMyDeploymentConf, IBotConf, ILaunchReportPayload } from '../../in-house-bot/types'

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
    hrEmail: 'hr@example.com'
  }

  conf._author = configuredBy.link

  const parent = createBot()
  const childTradle = createTestTradle()
  const childUrl = 'childurl'
  childTradle.serviceMap.RestApi.ApiGateway.url = childUrl
  const child = createBot({ tradle: childTradle })
  const parentDeployment = new Deployment({
    bot: parent,
    logger: parent.logger.sub('deployment:test:parent'),
    conf: { senderEmail }
  })

  const childDeployment = new Deployment({
    bot: child,
    logger: child.logger.sub('deployment:test:child')
  })

  const childIdentity = await child.getMyIdentity()
  const kv = {}
  sandbox.stub(parent, 'getMyIdentityPermalink').resolves('abc')
  const sendStub = sandbox.stub(parent, 'send').resolves({})

  sandbox.stub(parentDeployment.kv, 'put').callsFake(async (key, value) => {
    t.equal(value, conf._link)
    kv[key] = value
  })

  sandbox.stub(parentDeployment.kv, 'get').callsFake(async (key) => {
    if (kv[key]) return kv[key]

    throw new Errors.NotFound(key)
  })

  let deploymentConf: IMyDeploymentConf
  let expectedLaunchReport
  let pubConfStub = sandbox.stub(parent.buckets.PublicConf, 'putJSON').callsFake(async (key, val) => {
    deploymentConf = {
      stackId: child.stackUtils.getThisStackId(),
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
    }
  })

  // const getTemplate = sandbox.stub(parent.stackUtils, 'getStackTemplate')
  //   .resolves(require('../../../.serverless/cloudformation-template-update-stack'))

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

  const launchUrl = await parentDeployment.getLaunchUrl({
    name: 'testo',
    domain: 'testo.test',
    logo: 'somewhere/somelogo.png',
    configurationLink: conf._link,
    stackPrefix: conf.stackPrefix
  })

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
  //   if (params.Key === PRIVATE_CONF_BUCKET.bot) {
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

  t.equal(postStub.callCount, 1)
  t.same(sentEmails.sort(), [conf.adminEmail, conf.hrEmail].sort())
  t.equal(sendStub.getCall(0).args[0].to, conf._author)
  t.equal(parentAddFriendStub.callCount, 1)
  t.equal(childLoadFriendStub.callCount, 1)
  t.equal(saveChildDeploymentStub.callCount, 1)
  t.equal(childDeploymentResource.deploymentUUID, deploymentConf.deploymentUUID)

  sandbox.stub(parent.db, 'findOne').resolves(childDeploymentResource)

  pubConfStub.restore()
  pubConfStub = sandbox.stub(parent.buckets.PublicConf, 'putJSON').callsFake(async (key, template) => {
    t.equal(template.Mappings, undefined)
  })

  const updateUrl = await parentDeployment.getUpdateUrl({
    createdBy: childIdentity._permalink
  })

// console.time('render and juice')
//   const launchEmail = parentDeployment.genLaunchEmailBody({ launchUrl })
//   console.log(launchEmail)
// console.timeEnd('render and juice')
  t.equal(pubConfStub.callCount, 1)
  sandbox.restore()
  t.end()
}))
