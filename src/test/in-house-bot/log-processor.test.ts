require('../env').install()

import crypto from 'crypto'
import test from 'tape'
import {
  LogProcessor,
  parseLogEvent,
  parseLogEntry,
  parseLogEntryMessage,
  parseMessageBody,
  ParsedEvent,
} from '../../in-house-bot/log-processor'
import { noopLogger } from '../../logger'
import { KeyValueMem } from '../../key-value-mem'

const rawLogEvent = require('../fixtures/raw-log-event.json')
const expectedParsed:ParsedEvent = require('../fixtures/parsed-log-event.json')

test('log parsing', t => {
  // const parsed = sampleLog.map(parseLogEntryMessage)
  t.equal(parseMessageBody('AWS_XRAY_CONTEXT_MISSING is set. Configured context missing strategy to LOG_ERROR.\n"').__xray__, true)
  t.same(parseLogEvent(rawLogEvent), expectedParsed)
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
