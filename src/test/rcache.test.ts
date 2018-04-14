require('./env').install()

import test from 'tape'
import sinon from 'sinon'
import { TYPE, SIG } from '@tradle/constants'
import {
  loudAsync,
} from '../utils'

import { randomString } from '../crypto'
import models from '../models'
import { createTestTradle } from '../'
import { createBot } from '../bot'
import { RCache } from '../bot/rcache'
import { Resource } from '../bot/resource'

const alice = {
  keys: require('./fixtures/alice/keys'),
  identity: require('./fixtures/alice/object').object
}

test('resource wrapper', loudAsync(async (t) => {
  const sandbox = sinon.createSandbox()
  const tradle = createTestTradle()
  const bot = createBot({ tradle })
  sandbox.stub(bot, 'sign').callsFake(async (object) => tradle.provider.signObject({
    object,
    author: alice
  }))

  const photoId = new Resource({
    bot,
    models,
    type: 'tradle.PhotoID'
  })

  photoId.set({
    documentType: 'passport',
    country: 'GB',
    scan: {
      url: 'http://...'
    }
  })

  t.equal(photoId.isSigned(), false)
  await photoId.sign()

  t.equal(photoId.isSigned(), true)
  t.same(photoId.key, {
    [TYPE]: photoId.type,
    _permalink: photoId.permalink
  })

  t.equal(photoId.keyString, 'tradle.PhotoID"' + photoId.permalink)
  t.same(photoId.parseKeyString('tradle.PhotoID"' + photoId.permalink), photoId.key)

  photoId.set({
    firstName: 'Bob'
  })

  t.equal(photoId.isSigned(), false)
  t.end()
}))

test('resource cache', loudAsync(async (t) => {
  const sandbox = sinon.createSandbox()
  const tradle = createTestTradle()
  const bot = createBot({ tradle })
  sandbox.stub(bot, 'sign').callsFake(async (object) => tradle.provider.signObject({
    object,
    author: alice
  }))

  sandbox.stub(bot, 'save').callsFake(async (r) => r)

  const rcache = new RCache({ bot })
  const photoId = rcache.create('tradle.PhotoID')
  photoId.set({
    documentType: 'passport',
    country: 'GB',
    scan: {
      url: 'http://...'
    }
  })

  await photoId.signAndSave()
  t.ok(rcache.get(photoId.permalink))

  const v = rcache.create('tradle.Verification')
  v.set({
    document: photoId.stub
  })

  await v.signAndSave()
  t.same(photoId.getBacklinks(), {
    verifications: [v.stub]
  })

  sandbox.restore()
  t.end()
}))
