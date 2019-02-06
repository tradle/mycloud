require('./env').install()

import _ from 'lodash'
import test from 'tape'
import sinon from 'sinon'
import { TYPE, ORG,ORG_SIG } from '@tradle/constants'
import { loudAsync } from '../utils'
import { addLinks } from '../crypto'
import { createTestBot } from '../'
import Errors from '../errors'

const aliceKeys = require('./fixtures/alice/keys')
const bobKeys = require('./fixtures/bob/keys')
const aliceIdentity = require('./fixtures/alice/identity')
const bobIdentity = require('./fixtures/bob/identity')

addLinks(aliceIdentity)
addLinks(bobIdentity)

test('sign/witness', loudAsync(async (t) => {
  const sandbox = sinon.createSandbox()
  const alice = createTestBot({
    identity: aliceIdentity,
    keys: aliceKeys
  })

  const org = createTestBot({
    identity: bobIdentity,
    keys: bobKeys
  })

  const orgPermalink = await org.getPermalink()
  const signedByAlice = await alice.sign({
    [ORG]: orgPermalink,
    [TYPE]: 'tradle.SimpleMessage',
    message: 'hey'
  })

  const witnessed = await org.witness(signedByAlice)

  t.ok(witnessed, ORG_SIG)
  t.same(_.omit(witnessed, [ORG_SIG]), signedByAlice)
  t.doesNotThrow(() => alice.objects.getMetadata(witnessed))

  const orgIdentity = await org.identity.getPublic()
  sandbox.stub(org.identities, 'getPubKeyMapping').callsFake(async ({ pub }) => {
    if (aliceIdentity.pubkeys.some(k => k.pub === pub)) {
      return { permalink: aliceIdentity._permalink }
    }

    if (orgIdentity.pubkeys.some(k => k.pub === pub)) {
      return { permalink: orgIdentity._permalink }
    }

    throw new Errors.NotFound(`identity with pub: ${pub}`)
  })

  await org.identities.verifyAuthor(witnessed)

  sandbox.restore()
  t.end()
}))
