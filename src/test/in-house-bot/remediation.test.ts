require('../env').install()

import _ from 'lodash'
// @ts-ignore
import Promise from 'bluebird'
import test from 'tape'
import sinon from 'sinon'
import { TYPE, SIG, OWNER } from '@tradle/constants'
import buildResource from '@tradle/build-resource'
import fakeResource from '@tradle/build-resource/fake'
import createProductsStrategy from '@tradle/bot-products'
import { Remediation, idToStub, stubToId } from '../../in-house-bot/remediation'
import {
  createPlugin as createRemediationPlugin
} from '../../in-house-bot/plugins/remediation'
import {
  createPlugin as createPrefillFromDraftPlugin
} from '../../in-house-bot/plugins/prefill-from-draft'
import { loudAsync, parseStub, getResourceIdentifier } from '../../utils'
import { addLinks } from '../../crypto'
import Errors from '../../errors'
import { Logger } from '../../logger'
import { createBot } from '../../bot'
import { TYPES } from '../../in-house-bot/constants'
import models from '../../models'
import { IPBApp, IPBReq, IFormRequest } from '../../in-house-bot/types'
import { Resource } from '../../bot/resource'

const users = require('../fixtures/users.json')
const dataBundle = require('../fixtures/data-bundle.json')

const {
  DATA_CLAIM,
  DATA_BUNDLE,
  FORM,
  APPLICATION,
  PRODUCT_REQUEST,
  DRAFT_APPLICATION,
  FORM_PREFILL
} = TYPES

test('remediation plugin', loudAsync(async (t) => {
  const sandbox = sinon.createSandbox()
  const claim = {
    [TYPE]: DATA_CLAIM,
    [SIG]: 'somesig',
    claimId: stubToId({
      claimType: 'bulk',
      key: 'abcd',
      nonce: '1234'
    })
  }

  const user = { id: 'bob' }
  const bot = createBot()
  const productsAPI = {
    sendSimpleMessage: sandbox.stub().resolves(),
    send: sandbox.stub().callsFake(async ({ to, object }) => {
      const { items } = object
      t.equal(items.length, dataBundle.items.length)
      t.ok(items.every(item => {
        const isForm = models[item[TYPE]].subClassOf === FORM
        const ok = item[SIG] && (!isForm || item[OWNER] === user.id)
        if (!ok) debugger
        return ok
      }))
    })
  }

  const { api, plugin } = createRemediationPlugin({
    bot,
    productsAPI,
    friends: null,
    employeeManager: null,
    applications: null,
    conf: null,
    logger: new Logger('test:remediation1.0')
  }, {
    logger: new Logger('test:remediation1.1')
  })

  api.keyToClaimIds = api.keyToClaimIds.sub('test-' + Date.now())
  sandbox.stub(api, 'getBundleByClaimId').callsFake(async (id) => {
    t.equal(id, claim.claimId)
    return dataBundle
  })

  sandbox.stub(api, 'onClaimRedeemed').callsFake(async ({ user, claimId }) => {
    t.equal(claimId, claim.claimId)
  })

  t.doesNotThrow(() => api.validateBundle(dataBundle))
  await plugin[`onmessage:${DATA_CLAIM}`]({
    user,
    payload: claim
  })

  t.equal(productsAPI.send.callCount, 1)
  sandbox.restore()
  t.end()
}))

test('remediation api', loudAsync(async (t) => {
  const sandbox = sinon.createSandbox()
  const bundle = {
    items: [
      {
        _t: 'tradle.WealthCV',
        narrative: 'got rich'
      },
      {
        _t: 'tradle.Verification',
        document: 0,
        dateVerified: 12345
      }
    ]
  }

  const user = { id: 'b5da273e0254479d5e611a1ded1effecf751e6e6588dc6648fc21f5e036961c0' }
  const bot = createBot()
  const remediation = new Remediation({
    bot,
    productsAPI: {
      plugins: {
        use: ({ onmessage }) => { }
      }
    },
    conf: {
      deleteRedeemedClaims: true,
    },
    logger: new Logger('test:remediation')
  })

  remediation.keyToClaimIds = remediation.keyToClaimIds.sub('test-' + Date.now())
  const stub = await remediation.genClaimStub({ bundle, claimType: 'bulk' })
  t.same(idToStub(stub.claimId), {
    key: stub.key,
    nonce: stub.nonce,
    claimType: 'bulk',
    claimId: stub.claimId
  })

  const key = await remediation.saveUnsignedDataBundle(bundle)
  const { claimId } = await remediation.createClaim({ key, claimType: 'bulk' })
  const saved = await remediation.getBundleByClaimId(claimId)
  t.same(saved, bundle)
  await remediation.onClaimRedeemed({ user, claimId })
  try {
    await remediation.getBundleByClaimId(claimId)
    t.fail('expected claim to have been deleted')
  } catch (err) {
    t.ok(Errors.isNotFound(err))
  }

  sandbox.restore()
  t.end()
}))

test('prefill-based', loudAsync(async (t) => {
  const sandbox = sinon.createSandbox()
  const userFixture = users[0]
  const user = {
    id: userFixture.link,
    identity: userFixture.identity
  }

  const bot = createBot()
  const unsignedForms = dataBundle.items.filter(item => models[item[TYPE]].subClassOf === FORM)
  const product = 'tradle.WealthManagementAccount'
  const productRequest = bot.draft({
    type: PRODUCT_REQUEST
  })
  .set({
    requestFor: product,
    contextId: 'abc'
  })

  await productRequest.sign()
  const draft = await bot.draft({
    type: DRAFT_APPLICATION,
  })
  .set({
    requestFor: productRequest.get('requestFor'),
    request: productRequest.stub
  })
  .signAndSave()

  const draftStub = draft.stub
  const unsignedPrefills = unsignedForms.map(prefill => toPrefill({ prefill, draft }))
  const prefills = await Promise.mapSeries(unsignedPrefills, resource => bot.draft({
    resource
  }).signAndSave())

  // const prefills = await Promise.all(unsignedPrefills.map(bot.createResource))

  const prefillStubs = prefills.map(resource => resource.stub)
  const objects = {}
  prefills.concat(productRequest).forEach(res => {
    objects[res.link] = res.toJSON()
  })

  const productsAPI = createProductsStrategy({
    logger: bot.logger.sub('products'),
    bot,
    models: {
      all: models
    },
    products: [product],
    nullifyToDeleteProperty: true
  })

  // const productsAPI = {
  //   state: {
  //     createApplication: ({ user }) => {

  //     }
  //   },
  //   send: sandbox.stub().callsFake(async ({ to, object }) => {
  //   })
  // }

  const { api, plugin } = createRemediationPlugin({
    bot,
    productsAPI,
    friends: null,
    employeeManager: null,
    applications: null,
    logger: new Logger('test:remediation1.2')
  }, {
    logger: new Logger('test:remediation1.3')
  })

  sandbox.stub(bot.objects, 'get').callsFake(async (link) => {
    if (objects[link]) return objects[link]

    throw new Errors.NotFound(link)
  })

  // let bundle
  // sandbox.stub(api.store.bucket, 'put').callsFake(async (key, val) => {
  //   bundle = val
  // })

  // sandbox.stub(api.store, 'get').callsFake(async (key) => {
  //   return bundle
  // })


  let keyToClaimIds = {}
  sandbox.stub(api.keyToClaimIds, 'put').callsFake(async (key, val) => {
    keyToClaimIds[key] = val
  })

  sandbox.stub(api.keyToClaimIds, 'get').callsFake(async (key) => {
    if (keyToClaimIds[key]) return keyToClaimIds[key]

    throw new Errors.NotFound(key)
  })

  const draftRes = draft.toJSON({ virtual: true })
  sandbox.stub(bot, 'getResource').callsFake(async (stub, opts={}) => {
    const { type, permalink, link } = getResourceIdentifier(stub)
    if (permalink === draft.permalink || link === draftStub._link) {
      return opts.backlinks ? { ...draftRes, formPrefills: prefillStubs } : draftRes
    }

    const idx = prefillStubs.findIndex(stub => stub._permalink === permalink)
    if (idx !== -1) {
      return prefills[idx].toJSON({ virtual: true })
    }

    throw new Errors.NotFound(type + permalink)
  })

  const stub = await api.createClaimForApplication({
    claimType: 'prefill',
    draft: draftRes
  })

  const prefillFromDraft = createPrefillFromDraftPlugin({
    bot,
    productsAPI,
    remediation: api,
    friends: null,
    employeeManager: null,
    applications: null,
    logger: new Logger('test:bot-logger')
  }, {
    logger: new Logger('test:prefill-from-draft'),
  })

  const req = <IPBReq>{}
  const application = productsAPI.state.createApplication({
    user,
    object: {
      ..._.omit(productRequest.toJSON(), SIG),
      contextId: stub.claimId,
      [SIG]: 'somesig'
    }
  })

  await api.handlePrefillClaim({
    user,
    application,
    claimId: stub.claimId
  })

  t.equal(application.prefillFromApplication.id, draftStub.id)

  const formRequest = <IFormRequest>{
    form: unsignedPrefills[0].prefill[TYPE]
  }

  await prefillFromDraft.plugin.willRequestForm({
    user,
    application,
    formRequest
  })

  t.same(formRequest.prefill, unsignedForms[0])

  const stub2 = await api.createClaimForApplication({
    claimType: 'prefill',
    draft: draftRes
  })

  // plugin.onFormsCollected

  // sandbox.stub(api, 'getBundleByClaimId').callsFake(async (id) => {
  //   t.equal(id, claim.claimId)
  //   return dataBundle
  // })

  // sandbox.stub(api, 'onClaimRedeemed').callsFake(async ({ user, claimId }) => {
  //   t.equal(claimId, claim.claimId)
  // })

  sandbox.restore()
  t.end()
}))

const toPrefill = ({ draft, prefill }) => ({
  [TYPE]: FORM_PREFILL,
  draft: draft.stub,
  prefill
})
