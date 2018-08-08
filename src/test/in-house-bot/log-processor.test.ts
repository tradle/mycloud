require('../env').install()

import test from 'tape'
import sinon from 'sinon'
import * as LP from '../../in-house-bot/log-processor'
import { noopLogger } from '../../logger'
import { KeyValueMem } from '../../key-value-mem'
import { loudAsync } from '../../utils'

import rawAlertEvent from '../fixtures/events/sns'
const rawLogEvent = require('../fixtures/events/raw-log-event.json')
const parsedLogEvent:LP.ParsedLogEvent = require('../fixtures/events/parsed-log-event.json')
const parsedAlertEvent = {
  accountId: '12345678902',
  region: 'us-east-1',
  stackName: 'tdl-example-ltd-dev',
  timestamp: 0,
  eventUrl: JSON.parse(rawAlertEvent.Records[0].Sns.Message).eventUrl,
}

test('log entry and alert parsing', loudAsync(async t => {
  // const parsed = sampleLog.map(parseLogEntryMessage)
  t.equal(LP.parseMessageBody('AWS_XRAY_CONTEXT_MISSING is set. Configured context missing strategy to LOG_ERROR.\n"').__xray__, true)
  t.same(LP.parseLogEvent(rawLogEvent), parsedLogEvent)
  t.same(LP.getLogEventKey(parsedLogEvent), 'logs/1970-01-01/00:00/big-mouth-dev-get-index/17d4646a672daea64385cbdc')
  t.equal(LP.parseLogEvent(rawLogEvent).entries.length, 11)
  t.equal(LP.getAlertEventKey(parsedAlertEvent), 'alerts/12345678902/tdl-example-ltd-dev-us-east-1/1970-01-01/00:00/00-0e3c863613')
  t.ok(LP.parseAlertEvent(rawAlertEvent).eventUrl)

  t.end()
}))

test('log processor', loudAsync(async t => {
  const sandbox = sinon.createSandbox()
  const sendAlertStub = sandbox.stub()
  const store = new KeyValueMem()
  const processor = new LP.LogProcessor({
    logger: noopLogger,
    sendAlert: sendAlertStub,
    store,
    ext: 'json.gz',
  })

  const putStub = sandbox.stub(store, 'put').callsFake(async (k, v) => {
    t.ok(k.endsWith('.json.gz'))
  })

  await processor.handleLogEvent(parsedLogEvent)
  t.equal(putStub.callCount, 1)
  t.equal(sendAlertStub.callCount, 1)
  t.same(sendAlertStub.getCall(0).args[0].event, parsedLogEvent)

  sandbox.restore()
  t.end()
}))

test('log processor topics', t => {
  const stackArn = 'arn:aws:cloudformation:us-east-1:012345678912:stack/my-stack-name'
  t.equal(LP.getLogAlertsTopicName('my-stack-name'), 'my-stack-name-alerts')
  t.equal(LP.getLogAlertsTopicArn({
    sourceStackId: stackArn,
    targetAccountId: '987654321098',
  }), 'arn:aws:sns:us-east-1:987654321098:my-stack-name-alerts')

  t.same(LP.parseLogAlertsTopicArn('arn:aws:sns:us-east-1:012345678912:tdl-fresh-ltd-dev-alerts'), {
    accountId: '012345678912',
    region: 'us-east-1',
    stackName: 'tdl-fresh-ltd-dev',
  })

  t.end()
})
