require('./env').install()

import test from 'tape'
import sinon from 'sinon'
import { loudAsync } from '../utils'
import { StreamProcessor } from '../stream-processor'
import { KeyValueMem } from '../key-value-mem'

test('stream-processor', loudAsync(async (t) => {
  const sandbox = sinon.createSandbox()
  const store = new KeyValueMem()
  const getSpy = sandbox.spy(store, 'get')
  const putSpy = sandbox.spy(store, 'put')

  const processor = new StreamProcessor({ store })
  const events = [
    { attemptsBeforeSuccess: 0, attempts: 0 },
    { attemptsBeforeSuccess: 2, attempts: 0 },
    { attemptsBeforeSuccess: 1, attempts: 0 },
    { attemptsBeforeSuccess: 0, attempts: 0 },
  ].map((e, i) => ({ ...e, id: String(i) }))

  const worker = async (event) => {
    if (event.attempts++ >= event.attemptsBeforeSuccess) {
      // succeed
      return
    }

    throw new Error('test error')
  }

  const tryAgain = () => processor.processBatch({
    batch: events,
    worker,
    timeout: 5000,
    perItemTimeout: 1000
  })

  await tryAgain()

  const batchId = events[0].id
  t.equal(events[0].attempts, 1, 'pass on first try')
  t.equal(events[1].attempts, 1)
  t.equal((await store.get(batchId)).eventId, events[1].id, 'failed attempt recorded')

  await tryAgain()
  t.equal(events[0].attempts, 1, 'pass not re-handled')
  t.equal(events[1].attempts, 2, 'failed event re-tried')
  t.equal((await store.get(batchId)).eventId, events[1].id)

  await tryAgain()
  t.equal(events[0].attempts, 1)
  t.equal(events[1].attempts, 3)
  t.equal(events[2].attempts, 1)
  t.equal((await store.get(batchId)).eventId, events[2].id)

  await tryAgain()
  t.equal(events[0].attempts, 1)
  t.equal(events[1].attempts, 3)
  t.equal(events[2].attempts, 2)
  t.equal(events[3].attempts, 1)
  try {
    await store.get(batchId)
    t.fail('expected error state to have been deleted')
  } catch (err) {
    t.ok(err, 'error state cleared after batch succeeds')
  }

  sandbox.restore()
  t.end()
}))
