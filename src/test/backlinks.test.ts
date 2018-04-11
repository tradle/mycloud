require('./env').install()

import test from 'tape'
import _ from 'lodash'
import sinon from 'sinon'
import { TYPE, SIG, PREVLINK, PERMALINK } from '@tradle/constants'
import buildResource from '@tradle/build-resource'
import fakeResource from '@tradle/build-resource/fake'
import models from '../models'
import {
  Backlinks,
  getForwardLinks,
  // toBacklinks,
  getBacklinkChangesForChanges,
  serializeSource,
  // getUpdateForBacklinkChange
} from '../backlinks'
import Errors from '../errors'
import {
  loudAsync,
  setVirtual,
  parseId,
  parseStub,
  getPermId
} from '../utils'
import { IIdentity } from '../types'
import { createTestTradle } from '../'

test('update backlinks', loudAsync(async (t) => {
  const sandbox = sinon.createSandbox()
  const { modelStore, db, backlinks } = createTestTradle()
  const models = modelStore.models
  const model = {
    ...models['tradle.Verification'],
    required: ['document', 'organization']
  }

  const createFakeVerification = () => {
    const v = fakeResource({
      models,
      model,
      signed: true
    })

    v.document.id = v.document.id.replace('tradle.Form', 'tradle.PhotoID')
    return v
  }

  const v = createFakeVerification()
  const blItems = getForwardLinks({
    models,
    resource: v
  })

  const vStub = parseStub(buildResource.stub({ resource: v }))
  const old = {
    ...createFakeVerification(),
    _permalink: v._permalink
  }

  const oldVStub = parseStub(buildResource.stub({ resource: old }))
  const blChanges = getBacklinkChangesForChanges({
    models,
    changes: [
      {
        value: v,
        old
      }
    ]
  })

  t.same(blChanges, {
    "add": [
      {
        "_t": "tradle.BacklinkItem",
        "source": serializeSource({
          type: vStub.type,
          permalink: vStub.permalink,
          property: 'document'
        }),
        "sourceLink": vStub.link,
        "linkProp": "document",
        "backlinkProps": ["verifications"],
        "target": getPermId(v.document),
        "targetLink": parseStub(v.document).link,
        "targetParsedStub": parseStub(v.document)
      }
    ],
    "del": [
      {
        "_t": "tradle.BacklinkItem",
        "source": serializeSource({
          type: oldVStub.type,
          permalink: oldVStub.permalink,
          property: 'document'
        }),
        "sourceLink": oldVStub.link,
        "linkProp": "document",
        "backlinkProps": ["verifications"],
        "target": getPermId(old.document),
        "targetLink": parseStub(old.document).link,
        "targetParsedStub": parseStub(old.document),
      }
    ]
  })

  await db.destroyTables()
  await db.createTables()

  await backlinks.processChanges([
    {
      value: v,
      old
    }
  ])

  const docStub = parseStub(v.document)
  const bls = await backlinks.fetchBacklinks(docStub)
  const vBls = {
    verifications: [
      { id: buildResource.id({ resource: v }) }
    ]
  }

  t.same(bls, vBls)

  const bls1 = await backlinks.fetchBacklinks({
    type: docStub.type,
    permalink: docStub.permalink,
    properties: ['verifications']
  })

  t.same(bls1, vBls)

  const bls2 = await backlinks.fetchBacklinks(parseStub(old.document))
  t.same(bls2, {})
  t.end()
}))

// test('update backlink', loudAsync(async (t) => {
//   const sandbox = sinon.createSandbox()
//   const permalink = 'abc'
//   const link = 'efg'
//   const type = 'tradle.PhotoID'
//   const id = buildResource.id({ type, permalink, link })
//   const { kv1, modelStore } = createTestTradle()
//   const store = kv1.sub('bltest:')
//   const backlinks = new Backlinks({ store, modelStore })
//   const expectedBacklinkValue = []
//   let lastBacklinkValue
//   const backlinkKey = `${type}_${permalink}.verifications`
//   const getStub = sandbox.stub(store, 'get').callsFake(async (key) => {
//     if (key === backlinkKey && lastBacklinkValue) {
//       return _.cloneDeep(lastBacklinkValue)
//     }

//     throw new Errors.NotFound(key)
//   })

//   const putStub = sandbox.stub(store, 'put').callsFake(async (key, value) => {
//     t.equal(key, backlinkKey)
//     t.same(value, expectedBacklinkValue)
//     lastBacklinkValue = value
//   })

//   const verification = {
//     [TYPE]: 'tradle.Verification',
//     [SIG]: 'sig1',
//     document: { id }
//   }

//   expectedBacklinkValue[0] = buildResource.id({ models, resource: verification })
//   // put 1
//   await backlinks.updateBacklinks(verification)
//   // shouldn't change
//   await backlinks.updateBacklinks(verification)

//   // version 2 of verification
//   const verification2 = _.extend({}, verification, {
//     [PREVLINK]: buildResource.link(verification),
//     [PERMALINK]: buildResource.permalink(verification),
//     [SIG]: 'sig2'
//   })

//   expectedBacklinkValue[0] = buildResource.id({ models, resource: verification2 })

//   // put 2
//   await backlinks.updateBacklinks(verification2)

//   const verification3 = _.extend({}, verification, {
//     [SIG]: 'sig3'
//   })

//   expectedBacklinkValue.push(buildResource.id({
//     resource: verification3,
//     models
//   }))

//   // put 3
//   await backlinks.updateBacklinks(verification3)

//   t.equal(putStub.callCount, 3)
//   sandbox.restore()
//   t.end()
// }))
