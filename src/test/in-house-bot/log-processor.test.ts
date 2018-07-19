require('../env').install()

import crypto from 'crypto'
import test from 'tape'
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

const rawLogEvent = require('../fixtures/raw-log-event.json')
const expectedParsed:ParsedEvent = require('../fixtures/parsed-log-event.json')

test('log parsing', t => {
  // const parsed = sampleLog.map(parseLogEntryMessage)
  t.equal(parseMessageBody('AWS_XRAY_CONTEXT_MISSING is set. Configured context missing strategy to LOG_ERROR.\n"').__xray__, true)
  t.same(parseLogEvent(rawLogEvent), expectedParsed)
  t.same(getLogEventKey(rawLogEvent), '1970-01-01/big-mouth-dev-get-index/17d4646a672daea64385cbdc')

  const processor = new LogProcessor({
    level: Level.DEBUG,
    logger: noopLogger,
    sendAlert: async () => {},
    store: new KeyValueMem()
  })

  t.equal(processor.parseEvent(rawLogEvent).entries.length, 4)
  t.end()
})

// test('log processor', t => {
//   const processor = new LogProcessor({
//     ignoreGroups: [],
//     logger: noopLogger,
//     sendAlert: (events, idx) => {
//     },
//     store: new KeyValueMem()
//   })
// })
