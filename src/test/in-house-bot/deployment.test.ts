require('../env').install()

import QueryString from 'querystring'
import URL from 'url'
import _ from 'lodash'
import test from 'tape'
import sinon from 'sinon'
import { TYPE } from '@tradle/constants'
import fake from '@tradle/build-resource/fake'
import buildResource from '@tradle/build-resource'
import { Deployment } from '../../in-house-bot/deployment'
import * as utils from '../../utils'
import { StackUtils } from '../../stack-utils'
import Errors from '../../errors'
import { createTestBot } from '../../'
import models from '../../models'
import {
  IMyDeploymentConf,
  MyCloudLaunchTemplate,
} from '../../in-house-bot/types'
import { createTestEnv } from '../env'

const users = require('../fixtures/users.json')
const { loudAsync } = utils
const CHILD_DEPLOYMENT = 'tradle.cloud.ChildDeployment'
const TMP_SNS_TOPIC = 'tradle.cloud.TmpSNSTopic'
const VERSION_INFO = 'tradle.cloud.VersionInfo'

test('deployment by referral', loudAsync(async (t) => {
  const sandbox = sinon.createSandbox()
  const configuredBy = users[0].identity
  const senderEmail = 'sender@example.com'
  const region = 'ap-southeast-2'
  const childChain = 'ethereum:ropsten'
  const conf = {
    ...fake({
      models,
      model: models['tradle.cloud.Configuration'],
      signed: true
    }),
    region: Deployment.encodeRegion(region),
    blockchain: Deployment.encodeBlockchainEnumValue(childChain),
    name: 'myorg',
    domain: 'example.com',
    adminEmail: 'admin@example.com',
    hrEmail: 'hr@example.com',
    stackName: 'mytradle',
  }

  conf._author = users[0].link

  const parent = createTestBot()
  const child = createBotInRegion({ region })
  sandbox.stub(child.blockchain, 'toString').returns(childChain)

  const childUrl = 'http://tradle.somewhereoverthe.com'
  child.serviceMap.RestApi.ApiGateway.url = childUrl

  const parentDeployment = new Deployment({
    bot: parent,
    logger: parent.logger.sub('deployment:test:parent'),
    conf: {
      senderEmail,
      stackStatusNotificationsEmail: senderEmail
    },
    org: {
      name: 'parent',
      domain: 'parent.io'
    }
  })

  const parentTemplateUrl = 'original.template.url'

  const childOrg = {
    name: 'bagel',
    domain: 'mydomain',
  }

  const childDeployment = new Deployment({
    bot: child,
    logger: child.logger.sub('deployment:test:child'),
    org: childOrg,
  })

  sandbox.stub(childDeployment, 'getCurrentAdminEmail').resolves(conf.adminEmail)

  const [
    childIdentity,
    parentIdentity
  ] = await Promise.all([
    child.getMyIdentity(),
    parent.getMyIdentity()
  ])

  // const kv = {}
  sandbox.stub(parent, 'getPermalink').resolves('abc')
  const parentSendStub = sandbox.stub(parent, 'send').resolves({})

  // sandbox.stub(parentDeployment.kv, 'put').callsFake(async (key, value) => {
  //   t.equal(value.link, conf._link)
  //   kv[key] = value
  // })

  // sandbox.stub(parentDeployment.kv, 'get').callsFake(async (key) => {
  //   if (kv[key]) return kv[key]

  //   throw new Errors.NotFound(key)
  // })

  const regionalBucket = await parentDeployment.getDeploymentBucketForRegion(region)

  let deploymentConf: IMyDeploymentConf
  let expectedLaunchReport
  const saveTemplateStub = sandbox.stub(parentDeployment, 'savePublicTemplate').callsFake(async ({ template, bucket }: {
    template: MyCloudLaunchTemplate
    bucket: string
  }) => {
    t.equal(bucket, regionalBucket)

    deploymentConf = {
      stackId: child.stackUtils.thisStackId,
      ...template.Mappings.deployment.init,
      // ...template.Mappings.org.init,
      name: childOrg.name,
      domain: childOrg.domain,
      adminEmail: Deployment.getAdminEmailFromTemplate(template),
      identity: childIdentity,
      apiUrl: childUrl,
    }

    expectedLaunchReport = {
      ..._.omit(deploymentConf, ['name', 'domain', 'logo', 'referrerUrl', 'stackName']),
      org: _.pick(deploymentConf, ['name', 'domain']),
      version: child.version,
      adminEmail: conf.adminEmail,
    }

    ;['identity', 'org'].forEach(prop => {
      expectedLaunchReport[prop] = utils.omitVirtual(expectedLaunchReport[prop])
    })

    return 'http://my.template.url'
  })

  const parentTemplate = {
    Parameters: {
      Stage: {
        Type: 'String',
        Default: 'dev',
      },
      BlockchainNetwork: {
        Type: 'String',
      },
      OrgName: {
        Type: 'String',
      },
      OrgDomain: {
        Type: 'String',
      },
      OrgLogo: {
        Type: 'String',
      },
      OrgAdminEmail: {
        Type: 'String',
      },
    },
    "Mappings": {
      "deployment": {
        "init": {
          "referrerUrl": "",
          "referrerIdentity": "",
          "deploymentUUID": "",
          "stackName": "tdl-xxxx-tdl-dev"
        }
      }
    },
    "Resources": {
      "Initialize": {
        "Properties": {}
      },
      BotUnderscoreoninitLogGroup: {
      },
      "SomeLambdaFunction": {
        "Type": "AWS::Lambda::Function",
        "Properties": {
          "Code": {
            "S3Bucket": {
              "Something": "NotRight"
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
  }

  sandbox.stub(parent.snsUtils, 'createTopic').callsFake(async (topic) => {
    return `arn:aws:sns:${region}:12345678902:${topic}`
  })

  sandbox.stub(parent.snsUtils, 'getTopicAttributes').resolves({
    Attributes: {
      Policy: JSON.stringify({
        Statement: []
      })
    }
  })

  sandbox.stub(parent.snsUtils, 'setTopicAttributes').resolves()
  sandbox.stub(parent.snsUtils, 'listSubscriptions').resolves([])
  sandbox.stub(parent.snsUtils, 'subscribe').resolves('arn:aws:sns:us-east-1:12345678902:some-uuid')
  sandbox.stub(parent.lambdaUtils, 'getPolicy').resolves({
    Statement: []
  })

  sandbox.stub(parent.lambdaUtils, 'addPermission').resolves()

  const getTemplate = sandbox.stub(parent.stackUtils, 'getStackTemplate').resolves(parentTemplate)
  const getStable = sandbox.stub(parent.db, 'findOne').callsFake(async ({ filter }) => {
    if (filter.EQ[TYPE] === 'tradle.cloud.VersionInfo') {
      getStable.restore()
      return {
        templateUrl: parentTemplateUrl
      }
    }

    throw new Errors.NotFound('not found')
  })

  const copyFiles = sandbox.stub(parent.buckets.ServerlessDeployment, 'copyFilesTo').callsFake(async ({
    bucket,
    keys
  }) => {
    t.equal(bucket, regionalBucket)
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
    t.equal(url, parentDeployment.getCallHomeUrl())
    t.equal(url, parentDeployment.getCallHomeUrl(deploymentConf.referrerUrl))
    t.same(data, expectedLaunchReport)
    try {
      await parentDeployment.handleCallHome(data)
    } catch (err) {
      t.error(err)
    }
  })

  const childLoadFriendStub = sandbox.stub(child.friends, 'load').callsFake(async ({ url }) => {
    t.equal(url, parent.apiBaseUrl)
    return {
      _permalink: 'abc',
      _link: 'abc',
      [TYPE]: 'tradle.MyCloudFriend',
      identity: buildResource.stub({ resource: parentIdentity })
    }
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
    if (resource[TYPE] === CHILD_DEPLOYMENT) {
      childDeploymentResource = resource
    } else if (resource[TYPE] === TMP_SNS_TOPIC) {
      topicResource = resource
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

  sandbox.stub(parent.s3Utils, 'getByUrl').resolves(parentTemplate)

  const launchPackage = await parentDeployment.genLaunchPackage({
    name: 'testo',
    domain: 'testo.test',
    logo: 'somewhere/somelogo.png',
    region,
    // configurationLink: conf._link,
    stackName: conf.stackName,
    adminEmail: conf.adminEmail,
    blockchain: childChain,
    _t: 'tradle.cloud.Configuration',
    _author: conf._author,
    _link: conf._link,
    _permalink: conf._permalink,
  })

  t.equal(copyFiles.callCount, 1)
  // t.equal(launchPackage.template.Resources.AwsAlertsAlarm.Properties.Subscription[0].Endpoint, conf.adminEmail)
  t.equal(launchPackage.template.Parameters.OrgAdminEmail.Default, conf.adminEmail)
  t.equal(launchPackage.template.Parameters.BlockchainNetwork.Default, childChain)
  t.equal(QueryString.parse(launchPackage.url.split('?').pop()).stackName, Deployment.expandStackName({ stackName: conf.stackName, stage: 'dev' }))
  // t.same(launchPackage.template.Resources.AwsAlertsAlarm.Properties.Subscription[0].Endpoint, {
  //   'Fn::FindInMap': ['org', 'contact', 'adminEmail']
  // })

  const launchUrl = launchPackage.url

  // const saveResourceStub = sandbox.stub(parent.db, 'put').callsFake(async (res) => {
  //   childDeploymentResource = res
  // })

  await childDeployment.callHomeTo({
    // myOrg: _.pick(deploymentConf, ['name', 'domain']),
    // myIdentity: childIdentity,
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

  // await require('../../in-house-bot/lambda/http/deployment-pingback').handler({
  //   event: {
  //     apiBaseUrl: child.apiBaseUrl,
  //     deploymentUUID: deploymentConf.deploymentUUID
  //   }
  // }, {
  //   done: t.error
  // }, t.error)

  await parentDeployment.notifyCreatorsOfChildDeployment(childDeploymentResource)

  t.equal(postStub.callCount, 1)
  t.equal(findChildDeployment.callCount, 1)
  t.same(sentEmails.sort(), [conf.adminEmail, conf.hrEmail].sort())
  t.equal(parentSendStub.getCall(0).args[0].to.id, conf._author)
  t.equal(parentAddFriendStub.callCount, 1)
  t.equal(childLoadFriendStub.callCount, 1)
  t.ok(topicResource)

  const saved = saveResourceStub.getCalls().map(call => call.args[0])
  const [childChanges, topicChanges] = _.partition(saved, r => r[TYPE] === CHILD_DEPLOYMENT)
  const [
    createChild,
    updateChild
  ] = childChanges

  // t.equal(createTopic[TYPE], TMP_SNS_TOPIC)
  t.equal(createChild[TYPE], CHILD_DEPLOYMENT)
  t.equal(createChild.deploymentUUID, deploymentConf.deploymentUUID)
  t.equal(updateChild.apiUrl, childUrl)

  sandbox.stub(parent.db, 'findOne').callsFake(async ({ filter }) => {
    const type = filter.EQ[TYPE]
    if (type === CHILD_DEPLOYMENT) {
      return childDeploymentResource
    }

    throw new Errors.NotFound(type)
  })

  saveTemplateStub.callsFake(async ({ template, bucket }) => {
    t.equal(bucket, regionalBucket)
    // only on launch
    // t.equal(template.Parameters.OrgAdminEmail.Default, conf.adminEmail)
    return 'http://my.template.url'
  })

  saveResourceStub.reset()

  const updateReq = await child.sign(childDeployment.draftUpdateRequest({
    adminEmail: conf.adminEmail,
    tag: '2.2.3',
    provider: parent.buildStub(parentIdentity),
  }))

  sandbox.stub(parentDeployment, 'getVersionInfoByTag').callsFake(async (tag) => {
    t.equal(tag, '2.2.3')
    return {
      templateUrl: parentTemplateUrl,
      tag,
      sortableTag: utils.toSortableTag(tag)
    }
  })

  sandbox.stub(parentDeployment, '_getTemplateByUrl').resolves(parentTemplate)

  let updateResponse
  const updatePkg = await parentDeployment.handleUpdateRequest({
    from: {
      id: buildResource.permalink(childIdentity),
      identity: childIdentity
    },
    req: updateReq
  })

  // only on launch
  // t.equal(updatePkg.template.Parameters.BlockchainNetwork.Default, childChain)

  updateResponse = getLastCallArg(parentSendStub).object
  t.equal(updateResponse[TYPE], 'tradle.cloud.UpdateResponse')

  const stubInvoke = sandbox.stub(child.lambdaUtils, 'invoke').callsFake(async ({ name, arg }) => {
    t.equal(name, 'updateStack')
    t.equal(arg.templateUrl, updatePkg.templateUrl)
  })

  const stubLookupRequest = sandbox.stub(childDeployment, 'lookupLatestUpdateRequest').resolves(updateReq)
  // const stubCreateTopic = sandbox.stub(childDeployment, 'createStackUpdateTopic').resolves()
  await childDeployment.handleUpdateResponse(updateResponse)

  // const { url } = await parentDeployment.genUpdatePackage({
  //   createdBy: childIdentity._permalink
  // })

  t.equal(copyFiles.callCount, 2)

  const [
    updateTopic,
    logTopic,
  ] = saveResourceStub.getCalls().map(call => call.args[0])

  ;[updateTopic, logTopic].forEach(topicRes => {
    t.equal(topicRes[TYPE], TMP_SNS_TOPIC)
    t.equal(utils.parseArn(topicRes.topic).region, region)
  })

  // console.log(parentDeployment.genLaunchEmailBody({ launchUrl }))
  // console.log('OIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIO')
  // console.log(parentDeployment.genLaunchedEmailBody({ launchUrl }))

  t.equal(saveTemplateStub.callCount, 2)
  // t.equal(stubCreateTopic.callCount, 1)

  // const deleteTmpSpy = sandbox.spy(parentDeployment, 'deleteTmpSNSTopic')
  // await parent.db.del(createTopic)
  // t.equal(deleteTmpSpy.callCount, 1)

  // await parentDeployment.deleteTmpSNSTopic(createTopic.topic)

  sandbox.restore()
  t.end()
}))

test('tradle and children', loudAsync(async (t) => {
  const sandbox = sinon.createSandbox()
  const region = 'ap-southeast-2'
  const tradle = createTestBot()
  tradle.version.commitsSinceTag = 0
  sandbox.stub(tradle.lambdaUtils, 'getPolicy').resolves({
    Statement: []
  })

  const child = createTestBot({
    env: createTestEnv({
      AWS_REGION: region,
      R_STACK: tradle.stackUtils.thisStackId.replace(tradle.env.AWS_REGION, region)
    })
  })

  child.version.commitsSinceTag = 0

  const tradleDeployment = new Deployment({
    bot: tradle,
    logger: tradle.logger.sub('deployment:test:parent'),
    org: {
      name: 'tradle',
      domain: 'tradle.io',
    }
  })

  const childDeployment = new Deployment({
    bot: child,
    logger: child.logger.sub('deployment:test:child'),
    org: {
      name: 'bagel',
      domain: 'bagel.yum',
    }
  })

  sandbox.stub(childDeployment, 'getCurrentAdminEmail').resolves('child@mycloud.tradle.io')

  const getVIStub = sandbox.stub(tradleDeployment, 'getVersionInfoByTag').resolves(tradle.version)
  const endpointExistsStub = sandbox.stub(utils, 'doesHttpEndpointExist').resolves(true)
  const saveStub = sandbox.stub(tradle, 'save').resolves({})
  await tradleDeployment.handleStackUpdate()
  t.equal(saveStub.callCount, 1)
  t.equal(saveStub.getCall(0).args[0][TYPE], TMP_SNS_TOPIC)

  getVIStub.rejects(new Errors.NotFound('version info'))

  await tradleDeployment.handleStackUpdate()
  const lastSavedVersionInfo = saveStub.getCalls().map(c => c.args[0]).reverse().find(obj => obj[TYPE] === VERSION_INFO)
  t.ok(_.isMatch(lastSavedVersionInfo, _.pick(tradle.version, ['tag', 'commit'])))

  const reportStub = sandbox.stub(childDeployment, 'callHomeTo').resolves()
  await childDeployment.handleStackUpdate()
  t.equal(reportStub.callCount, 1)

  // const postStub = sandbox.stub(utils, 'post').resolves({
  //   identity:
  // })

  // await childDeployment.callHomeTo({
  //   targetApiUrl: tradle.apiBaseUrl,
  // })

  // sandbox.stub(tradleDeployment, 'getChildDeploymentByStackId').rejects(new Errors.NotFound('stack'))
  // sandbox.stub(tradle.friends, 'add').resolves()
  // sandbox.stub(tradle, 'save').resolves()

  // const report = postStub.getCall(0).args[1]
  // t.same(report.version, child.version)

  // await tradleDeployment.handleCallHome(report)

  sandbox.restore()
  t.end()
}))

const getLastCallArg = (stub: sinon.SinonStub) => {
  return stub.getCalls().slice().pop().args[0]
}

export const createBotInRegion = ({ region }: { region: string }) => {
  const env = createTestEnv()
  return createTestBot({
    env: createTestEnv({
      AWS_REGION: region,
      // @ts-ignore
      R_STACK: env.R_STACK.replace(env.AWS_REGION, region)
    })
  })
}
