require('../env').install()

import test = require('tape')
import sinon = require('sinon')
import { TYPE, SIG, OWNER } from '@tradle/constants'
import { Remediation, parseClaimId } from '../../in-house-bot/remediation'
import {
  createPlugin as createRemediationPlugin
} from '../../in-house-bot/plugins/remediation'
import { loudAsync } from '../../utils'
import Errors = require('../../errors')
import { Logger } from '../../logger'
import { createBot } from '../../bot'
import { TYPES } from '../../in-house-bot/constants'
import models = require('../../models')

const dataBundle = require('../fixtures/data-bundle.json')

const {
  DATA_CLAIM,
  FORM
} = TYPES

test('remediation plugin', loudAsync(async (t) => {
  const claim = {
    [TYPE]: DATA_CLAIM,
    [SIG]: 'somesig',
    claimId: 'abc'
  }

  const user = { id: 'bob' }
  const bot = createBot()
  const productsAPI = {
    sendSimpleMessage: sinon.stub().resolves(),
    send: sinon.stub().callsFake(async ({ to, object }) => {
      const { items } = object
      t.equal(items.length, dataBundle.items.length)
      t.ok(items.every(item => {
        const isForm = models[item[TYPE]].subClassOf === FORM
        return item[SIG] && (!isForm || item[OWNER] === user.id)
      }))
    })
  }

  const { api, plugin } = createRemediationPlugin({
    bot,
    productsAPI,
    logger: new Logger('test:remediation1')
  })

  sinon.stub(api, 'getBundleByClaimId').callsFake(async (id) => {
    t.equal(id, claim.claimId)
    return dataBundle
  })

  sinon.stub(api, 'onClaimRedeemed').callsFake(async ({ user, claimId }) => {
    t.equal(claimId, claim.claimId)
  })

  t.doesNotThrow(() => api.validateBundle(dataBundle))
  await plugin[`onmessage:${DATA_CLAIM}`]({
    user,
    payload: claim
  })

  t.equal(productsAPI.send.callCount, 1)
  t.end()
}))

test('remediation api', loudAsync(async (t) => {
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
        use: ({ onmessage }) => {}
      }
    },
    logger: new Logger('test:remediation')
  })

  const stub = await remediation.genClaimStub({ bundle })
  t.same(parseClaimId(stub.claimId), {
    key: stub.key,
    nonce: stub.nonce
  })

  const key = await remediation.saveUnsignedDataBundle(bundle)
  const { claimId } = await remediation.createClaim({ key })
  const saved = await remediation.getBundleByClaimId(claimId)
  t.same(saved, bundle)
  await remediation.onClaimRedeemed({ user, claimId })
  try {
    await remediation.getBundleByClaimId(claimId)
    t.fail('expected claim to have been deleted')
  } catch (err) {
    t.ok(Errors.matches(err, Errors.NotFound))
  }

  t.end()
}))
