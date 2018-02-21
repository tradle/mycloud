require('../env').install()

import querystring = require('querystring')
import _ = require('lodash')
import test = require('tape')
import sinon = require('sinon')
import { TYPE, SIG, OWNER } from '@tradle/constants'
import { Deployment } from '../../samplebot/deployment'
import * as utils from '../../utils'
import Errors = require('../../errors')
import { createBot } from '../../bot'
import { createTestTradle } from '../../'
import { TYPES } from '../../samplebot/constants'
import models = require('../../models')

const { loudAsync } = utils

test('deployment by referral', loudAsync(async (t) => {
  const parent = createBot()
  const childTradle = createTestTradle()
  const childUrl = 'childurl'
  childTradle.serviceMap.RestApi.ApiGateway.url = childUrl
  const child = createBot({ tradle: childTradle })
  const parentDeployment = new Deployment({
    bot: parent,
    logger: parent.logger.sub('deployment:test:parent')
  })

  const childDeployment = new Deployment({
    bot: child,
    logger: child.logger.sub('deployment:test:child')
  })

  const kv = {}
  const applicantLink = 'applicantlink'
  const configurationLink = 'conflink'
  sinon.stub(parent, 'getMyIdentityPermalink').resolves('abc')
  const sendStub = sinon.stub(parent, 'send').resolves({})

  sinon.stub(parentDeployment.kv, 'put').callsFake(async (key, value) => {
    t.equal(value, configurationLink)
    kv[key] = value
  })

  sinon.stub(parentDeployment.kv, 'get').callsFake(async (key) => {
    if (kv[key]) return kv[key]

    throw new Errors.NotFound(key)
  })

  let deploymentConf
  sinon.stub(parent.buckets.PublicConf, 'putJSON').callsFake(async (key, val) => {
    deploymentConf = val.Mappings.deployment.init
  })

  const conf = {
    _author: applicantLink,
    adminEmail: 'admin@example.com',
    hrEmail: 'hr@example.com',
  }

  const getStub = sinon.stub(parent.objects, 'get').callsFake(async link => {
    if (link === configurationLink) {
      return conf
    }

    throw new Errors.NotFound(link)
  })

  // sinon.stub(bot.stackUtils, 'getStackTemplate').resolves({
  //   Mappings: {
  //     deployment: {},
  //     org: {}
  //   }
  // })

  const postStub = sinon.stub(utils, 'post').callsFake(async (url, data) => {
    t.equal(url, deploymentConf.referrerUrl)
    t.same(data, {
      uuid: deploymentConf.deploymentUUID,
      // in real life this will be the newly deployed bot's url
      url: childUrl
    })

    await parentDeployment.receiveCallHome({
      ...data,
      senderEmail: 'sender@example.com'
    })
  })

  const sentEmails = []
  const emailStub = sinon.stub(parent.mailer, 'send').callsFake(async (opts) => {
    t.equal(opts.from, 'sender@example.com')
    sentEmails.push(...opts.to)
  })

  const launchUrl = await parentDeployment.getLaunchUrl({
    name: 'testo',
    domain: 'testo.test',
    logo: 'somewhere/somelogo.png',
    configurationLink
  })

  await childDeployment.callHome(deploymentConf)

  t.equal(postStub.callCount, 1)
  t.same(sentEmails.sort(), [conf.adminEmail, conf.hrEmail].sort())
  t.equal(sendStub.getCall(0).args[0].to, applicantLink)
  t.end()
}))
