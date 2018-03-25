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
  toBacklinks,
  getLatestVersionId,
  getBacklinkChangesForChanges,
  getUpdateForBacklinkChange
} from '../backlinks'
import Errors from '../errors'
import { loudAsync, setVirtual, parseId, parseStub } from '../utils'
import { IIdentity } from '../types'
import { createTestTradle } from '../'

test('update backlinks', loudAsync(async (t) => {
  const sandbox = sinon.createSandbox()
  const { kv1, modelStore } = createTestTradle()
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
  const forwardLinks = getForwardLinks({
    models,
    resource: v
  })

  const backlinks = toBacklinks(forwardLinks)
  const vStub = parseStub(buildResource.stub({ resource: v }))
  const getTargetId = stub => {
    if (!stub.type) stub = parseStub(stub)
    return getLatestVersionId(stub)
  }

  t.same(backlinks, [
    {
      targetId: getTargetId(v.document),
      backlinks: {
        verifications: {
          [getLatestVersionId(vStub)]: vStub.link
        }
      }
    },
    // {
    //   key: getLatestVersionId(parseStub(v.organization)),
    //   update: {
    //     verifications: {
    //       [getLatestVersionId(vStub)]: vStub.link
    //     }
    //   }
    // }
  ])

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

  t.same(blChanges, [
    {
      "targetId": getTargetId(old.document),
      "set": {},
      "remove": {
        "verifications": [
          getTargetId(oldVStub)
        ]
      },
      "isNew": false
    },
    {
      "targetId": getTargetId(v.document),
      "set": {
        "verifications": {
          [getTargetId(vStub)]: v._link
        }
      },
      "remove": {},
      "isNew": false
    }
  ])

  const updates = blChanges.map(getUpdateForBacklinkChange)
  t.same(updates, [
    {
      "key": getTargetId(old.document),
      "set": null,
      "unset": [
        // path to property
        [
          "verifications",
          getTargetId(oldVStub)
        ]
      ]
    },
    {
      "key": getTargetId(v.document),
      "set": [
        [
          // path to property
          [
            "verifications",
            getTargetId(vStub)
          ],
          // value
          vStub.link
        ]
      ],
      "unset": null
    }
  ])

  const store = kv1.sub('bltest:')
  const b = new Backlinks({ store, modelStore })
  await b.processChanges([
    {
      value: v,
      old
    }
  ])

  const bls = await b.getBacklinks(parseStub(v.document))
  t.same(bls, {
    verifications: {
      [getTargetId(vStub)]: vStub.link
    }
  })

  const bls2 = await b.getBacklinks(parseStub(old.document))
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
