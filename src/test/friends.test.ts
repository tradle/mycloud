require('./env').install()

import test from 'tape'
import sinon from 'sinon'
import { models } from '@tradle/models'
import { TYPE, AUTHOR, SIG, TIMESTAMP } from '@tradle/constants'
import buildResource from '@tradle/build-resource'
import { loudAsync, co, wait } from '../utils'
import { createTestTradle } from '../'

const fakeResource = require('@tradle/build-resource/fake')
const { identity, friends } = createTestTradle()
const alice = require('./fixtures/alice/object')
const bob = require('./fixtures/bob/object')

test('friends', loudAsync(async (t) => {
  const domain = 'friend.local'
  const friendOpts = {
    name: 'testfriend',
    url: `http://${domain}`,
    domain,
    identity: alice.object,
    org: await identity.sign({
      object: {
        [TYPE]: 'tradle.Organization',
        name: 'alice-org',
        [TIMESTAMP]: 123
      }
    })
  }

  // await friends.clear()
  await friends.removeByIdentityPermalink(alice.link)
  // console.log(JSON.stringify(await friends.list(), null, 2))
  const original = await friends.add(friendOpts)

  const friend = await friends.getByIdentityPermalink(alice.permalink)
  t.equal(friend.name, friendOpts.name)
  t.equal(friend.url, friendOpts.url)

  const byDomain = await friends.getByDomain(domain)
  t.same(byDomain, friend)
  friendOpts.url = 'blah'
  const updated = await friends.add(friendOpts)
  const byDomain1 = await friends.getByDomain(domain)
  t.equal(byDomain1.url, friendOpts.url)
  t.end()
}))
