require('./env').install()

import test from 'tape'
import sinon from 'sinon'
import { TYPE, SIG } from '@tradle/constants'
import {
  loudAsync,
} from '../utils'

import {
  prettify
} from '../string-utils'
import { randomString } from '../crypto'
import models from '../models'
import { createTestTradle } from '../'
import { createBot } from '../bot'
import { getResourceModuleStore } from '../bot/utils'
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
  sandbox.stub(bot, 'sign').callsFake(async (object) => tradle.identity.sign({
    object,
    author: alice
  }))

  const photoId = bot.draft({
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

  const { link, permalink, prevlink } = photoId
  t.equal(prevlink, undefined)

  t.same(photoId.key, {
    [TYPE]: photoId.type,
    _permalink: photoId.permalink
  })

  photoId.version()
  await photoId.sign()

  const v2link = photoId.link
  t.equal(photoId.prevlink, link)
  t.equal(photoId.permalink, permalink)
  t.notEqual(photoId.link, link)

  photoId.version()
  await photoId.sign()

  t.equal(photoId.prevlink, v2link)
  t.equal(photoId.permalink, permalink)
  t.notEqual(photoId.link, link)
  t.notEqual(photoId.link, v2link)

  await photoId.save()

  t.equal(photoId.keyString, 'tradle.PhotoID"' + photoId.permalink)
  t.same(photoId.parseKeyString('tradle.PhotoID"' + photoId.permalink), photoId.key)

  photoId.set({
    firstName: 'Bob'
  })

  t.equal(photoId.isSigned(), false)

  const v = new Resource({
    models,
    type: 'tradle.Verification'
  })

  let docStub = {
    ...photoId.stub
  }

  v.set({
    document: docStub
  })

  t.same(v.get('document'), docStub)

  docStub = {
    ...docStub,
    _link: 'abc'
  }

  v.set({
    document: docStub
  })

  t.same(v.get('document'), docStub)

  t.end()
}))

test('resource cache', loudAsync(async (t) => {
  const sandbox = sinon.createSandbox()
  const tradle = createTestTradle()
  const bot = createBot({ tradle })
  sandbox.stub(bot, 'sign').callsFake(async (object) => tradle.identity.sign({
    object,
    author: alice
  }))

  sandbox.stub(bot, 'save').callsFake(async (r) => r)

  const rcache = new RCache({ store: getResourceModuleStore(bot) })
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
