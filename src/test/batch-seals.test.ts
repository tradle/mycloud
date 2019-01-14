require('./env').install()

import _ from 'lodash'
import test from 'tape'
import sinon from 'sinon'
// @ts-ignore
import Promise from 'bluebird'
import { createSealBatcher, BATCH_NUM_LENGTH } from '../batch-seals'
import { createTestBot } from '../'
import Errors from '../errors'
import { loudAsync } from '../utils'
import { randomStringWithLength } from '../crypto'
import { consoleLogger } from '../logger'

const bot = createTestBot()
const microBatches = [
  [
    { link: '1234', time: 123, },
    { link: 'abcd', time: 456, },
  ],
  [
    // fits inside microBatch1, time-wise
    { link: 'dead', time: 300, },
    { link: 'beef', time: 400, },
  ],
  [
    // overlaps microBatch1
    // EARLIEST
    { link: 'dddd', time: 100, },
    { link: 'eeee', time: 200, },
  ],
]

const setup = opts => {
  const sandbox = sinon.createSandbox()
  const testFolder = `seals/batch/test/${randomStringWithLength(8)}`
  const folder = bot.buckets.Objects.folder(testFolder)
  const { db } = bot
  const batcher = createSealBatcher({
    db,
    folder,
    logger: consoleLogger,
    safetyBuffer: 2,
    ...opts,
  })

  return {
    folder,
    batcher,
    db,
    sandbox,
  }
}

test('enforce safety buffer', t => {
  try {
    setup({ safetyBuffer: 1 })
    t.fail('expected error about safety buffer')
  } catch (err) {
    t.ok(Errors.matches(err, Errors.InvalidInput))
  }

  t.end()
})

test('respect safety buffer', loudAsync(async t => {
  const safetyBuffer = 2
  const { batcher, folder, sandbox } = setup({ safetyBuffer })

  let lastBatch
  const spyPut = sandbox.spy(folder, 'gzipAndPut')
  const stubFindLast = sandbox.stub(bot.db, 'findOne').callsFake(async () => {
    return lastBatch
  })

  t.equal(await batcher.getLastBatchNumber(), -1)
  t.equal(await batcher.getNextBatchNumber(), 0)

  // let nextMicroBatchNumber = await batcher.getNextMicroBatchNumber()
  // t.equal(nextMicroBatchNumber, safetyBuffer)
  t.notOk(await batcher.getLastBatch())

  const microBatch1 = microBatches[0]
  const microBatch1MerkleRoot = '1d3792976568751704f3b6ababe5e5849986b9ab880b9cf4f62e4a09b6ec31e0'
  const firstBatchNumStr = '0'.repeat(BATCH_NUM_LENGTH)
  const expectedKey = `${firstBatchNumStr}/${microBatch1[0].time}/9b11457aa29d65e4940b.json`
  t.same(await batcher.createMicroBatch({ items: microBatch1 }), {
    batch: {
      merkleRoot: microBatch1MerkleRoot,
      links: [ '1234', 'abcd' ],
      fromTimestamp: 123,
      // LATEST
      toTimestamp: 456
    },
    number: 0,
    // 0 + safetyBuffer
    // number: safetyBuffer,
    key: expectedKey,
  })

  t.same(spyPut.getCall(0).args, [
    expectedKey,
    {
      merkleRoot: microBatch1MerkleRoot,
      links: microBatch1.map(i => i.link),
      fromTimestamp: microBatch1[0].time,
      toTimestamp: microBatch1[1].time,
    },
    {
      headers: {
        'Content-Type': 'application/json'
      }
    }
  ])

  // we're behind the safetyBuffer, so no items yet
  lastBatch = await batcher.genNextBatch()
  t.same(lastBatch, {
    batchNumber: 0
  })

  await batcher.createMicroBatch({
    items: microBatches[1],
  })

  // we're behind the safetyBuffer, so no items yet
  lastBatch = await batcher.genNextBatch()
  t.same(lastBatch, {
    batchNumber: 1
  })

  await batcher.createMicroBatch({
    items: microBatches[2],
  })

  lastBatch = await batcher.genNextBatch()
  // first microBatch
  t.equal(lastBatch.batchNumber, 2)
  t.equal(lastBatch.fromLink, microBatch1[0].link)
  t.equal(lastBatch.fromTimestamp, microBatch1[0].time)
  t.equal(lastBatch.toLink, microBatch1[1].link)
  t.equal(lastBatch.toTimestamp, microBatch1[1].time)

  sandbox.restore()
  t.end()
}))

test('merge micro batches', loudAsync(async t => {
  // reset
  let lastBatch
  const safetyBuffer = 2
  const { batcher, folder, sandbox } = setup({ safetyBuffer })

  const spyPut = sandbox.spy(folder, 'gzipAndPut')
  const stubFindLast = sandbox.stub(bot.db, 'findOne').callsFake(async () => {
    return lastBatch
  })

  await Promise.mapSeries(microBatches, items => batcher.createMicroBatch({ items }))

  for (let i = 0; i < safetyBuffer; i++) {
    lastBatch = await batcher.genNextBatch()
    t.same(lastBatch, { batchNumber: i })
  }

  t.equal((await batcher.getMicroBatchesForNextBatch()).microBatches.length, 3)

  lastBatch = await batcher.genNextBatch()
  t.equal(lastBatch.batchNumber, 2)
  t.equal(lastBatch.fromLink, 'dddd')
  t.equal(lastBatch.fromTimestamp, 100)
  t.equal(lastBatch.toLink, 'abcd')
  t.equal(lastBatch.toTimestamp, 456)

  t.equal(await batcher.getLastBatchNumber(), 2)
  t.equal(await batcher.getNextBatchNumber(), 3)

  sandbox.restore()
  t.end()
}))

// test('avoid empty batches', loudAsync(async t => {
//   // reset
//   let lastBatch
//   const safetyBuffer = 2
//   const { batcher, folder, sandbox } = setup({ safetyBuffer })

//   // no micro batches were queued
//   // we should still see empty batches before the safety buffer, but

//   const spyPut = sandbox.spy(folder, 'gzipAndPut')
//   const stubFindLast = sandbox.stub(bot.db, 'findOne').callsFake(async () => {
//     return lastBatch
//   })

//   let batchesCount = 0
//   while (batchesCount++ < safetyBuffer) {
//     lastBatch = await batcher.genNextBatch()
//     await t.ok(lastBatch, 'allow empty batches within safety buffer')
//   }

//   await t.notOk(await batcher.genNextBatch(), 'no empty batches past the safety buffer')

//   sandbox.restore()
//   t.end()
// }))
