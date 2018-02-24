require('../env').install()

import test = require('tape')
import sinon = require('sinon')
import { TYPE, SIG, OWNER } from '@tradle/constants'
import { Remediator, parseClaimId } from '../../in-house-bot/remediation'
import {
  Remediation,
  createPlugin as createProductsPlugin
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
    send: sinon.stub().callsFake(async ({ to, object }) => {
      const { items } = object
      t.equal(items.length, dataBundle.items.length)
      t.ok(items.every(item => {
        const isForm = models[item[TYPE]].subClassOf === FORM
        return item[SIG] && (!isForm || item[OWNER] === user.id)
      }))
    })
  }

  const remediation = new Remediation({
    bot,
    productsAPI,
    logger: new Logger('test:remediation1'),
    getBundleByClaimId: async (id) => {
      t.equal(id, claim.claimId)
      return dataBundle
    },
    onClaimRedeemed: async ({ user, claimId }) => {
      t.equal(claimId, claim.claimId)
    }
  })

  t.doesNotThrow(() => remediation.validateBundle(dataBundle))
  const plugin = createProductsPlugin({ remediation })
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
  const remediator = new Remediator({
    bot,
    productsAPI: {
      plugins: {
        use: ({ onmessage }) => {}
      }
    },
    logger: new Logger('test:remediation')
  })

  const stub = await remediator.genClaimStub({ bundle })
  t.same(parseClaimId(stub.claimId), {
    key: stub.key,
    nonce: stub.nonce
  })

  const key = await remediator.saveUnsignedDataBundle(bundle)
  const { claimId } = await remediator.createClaim({ key })
  const saved = await remediator.getBundleByClaimId({ claimId })
  t.same(saved, bundle)
  await remediator.onClaimRedeemed({ user, claimId })
  try {
    await remediator.getBundleByClaimId({ claimId })
    t.fail('expected claim to have been deleted')
  } catch (err) {
    t.ok(Errors.matches(err, Errors.NotFound))
  }

  t.end()
}))
