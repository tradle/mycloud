require('./env').install()

import test from 'tape'
import sinon from 'sinon'
import { models } from '@tradle/models'
import { TYPE } from '@tradle/constants'
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
        name: 'alice-org'
      }
    })
  }

  await friends.removeByIdentityPermalink(alice.link)
  await friends.add(friendOpts)

  const friend = await friends.getByIdentityPermalink(alice.permalink)
  t.equal(friend.name, friendOpts.name)
  t.equal(friend.url, friendOpts.url)

  t.same(await friends.getByDomain(domain), friend)
  friendOpts.url = 'blah'
  await friends.add(friendOpts)
  t.equal((await friends.getByDomain(domain)).url, friendOpts.url)
  t.end()
}))
