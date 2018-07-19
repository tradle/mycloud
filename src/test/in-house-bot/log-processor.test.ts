require('../env').install()

import crypto from 'crypto'
import test from 'tape'
import sinon from 'sinon'
import {
  LogProcessor,
  parseLogEvent,
  parseLogEntry,
  parseLogEntryMessage,
  parseMessageBody,
  getLogEventKey,
  ParsedEvent,
} from '../../in-house-bot/log-processor'
import { noopLogger, Level } from '../../logger'
import { KeyValueMem } from '../../key-value-mem'
import { loudAsync } from '../../utils'

const rawLogEvent = require('../fixtures/raw-log-event.json')
const expectedParsed:ParsedEvent = require('../fixtures/parsed-log-event.json')

test('log processor', loudAsync(async t => {
  const sandbox = sinon.createSandbox()
  // const parsed = sampleLog.map(parseLogEntryMessage)
  t.equal(parseMessageBody('AWS_XRAY_CONTEXT_MISSING is set. Configured context missing strategy to LOG_ERROR.\n"').__xray__, true)
  t.same(parseLogEvent(rawLogEvent), expectedParsed)
  t.same(getLogEventKey(rawLogEvent), '1970-01-01/00:00/big-mouth-dev-get-index/17d4646a672daea64385cbdc')

  const store = new KeyValueMem()
  const processor = new LogProcessor({
    level: Level.DEBUG,
    logger: noopLogger,
    sendAlert: async () => {},
    store,
    ext: 'json.gz',
  })

  t.equal(processor.parseEvent(rawLogEvent).entries.length, 4)

  const putStub = sandbox.stub(store, 'put').callsFake(async (k, v) => {
    t.ok(k.endsWith('.json.gz'))
  })

  await processor.handleEvent(rawLogEvent)
  t.equal(putStub.callCount, 1)
  sandbox.restore()
  t.end()
}))
