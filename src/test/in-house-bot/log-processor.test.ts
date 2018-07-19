require('../env').install()

import test from 'tape'
import {
  LogProcessor,
  parseLogEntry,
  parseLogEntryMessage,
  parseMessageBody,
} from '../../in-house-bot/log-processor'
import { noopLogger } from '../../logger'
import { KeyValueMem } from '../../key-value-mem'

const sampleLog = `
START RequestId: fe9e83ca-8af2-11e8-a5e2-b9d7a9e128fc Version: $LATEST
2018-07-19T01:28:09.405Z\tfe9e83ca-8af2-11e8-a5e2-b9d7a9e128fc\t{"namespace":"tradle:lambda:genericJobRunner","msg":"request context","level":"INFO","details":{"seq":16,"requestId":"fe9e83ca-8af2-11e8-a5e2-b9d7a9e128fc","correlationId":"fe9e83ca-8af2-11e8-a5e2-b9d7a9e128fc","containerId":"Andi Woodie Gavrielle fe52c47af47d","commit":"74ad1e04","start":1531963689405,"botReady":true,"trace-id":"Parent=5ff0394e26a55bf0"}}
2018-07-19T01:28:09.405Z\tfe9e83ca-8af2-11e8-a5e2-b9d7a9e128fc\t{"namespace":"tradle:genericJobRunner","msg":"running job: retryDelivery","level":"DEBUG"}
2018-07-19T01:28:09.405Z\tfe9e83ca-8af2-11e8-a5e2-b9d7a9e128fc\t{"namespace":"tradle:mid","msg":"firing","level":"SILLY","details":{"event":"job:retryDelivery"}}
2018-07-19T01:28:09.502Z\tfe9e83ca-8af2-11e8-a5e2-b9d7a9e128fc\t{"namespace":"tradle:db","msg":"DB.find tradle.DeliveryError","level":"SILLY","details":{"tags":["perf"],"success":true,"time":97}}
2018-07-19T01:28:09.511Z\tfe9e83ca-8af2-11e8-a5e2-b9d7a9e128fc\t{"namespace":"tradle:lambda:genericJobRunner","msg":"preparing for exit","level":"DEBUG","details":{"requestTime":106,"timeLeft":299893}}
2018-07-19T01:28:09.511Z\tfe9e83ca-8af2-11e8-a5e2-b9d7a9e128fc\t{"namespace":"tradle:async-tasks","msg":"no async tasks!","level":"SILLY"}
2018-07-19T01:28:09.512Z\tfe9e83ca-8af2-11e8-a5e2-b9d7a9e128fc\t{"namespace":"tradle:lambda:genericJobRunner","msg":"exiting","level":"SILLY"}
END RequestId: fe9e83ca-8af2-11e8-a5e2-b9d7a9e128fc
REPORT RequestId: fe9e83ca-8af2-11e8-a5e2-b9d7a9e128fc\tDuration: 107.52 ms Billed Duration: 200 ms \tMemory Size: 256 MB Max Memory Used: 143 MB
`.trim().split('\n')

const expectedParsed = [
  {
    "__": "START",
    "requestId": "fe9e83ca-8af2-11e8-a5e2-b9d7a9e128fc",
    "version": "$LATEST"
  },
  {
    "requestId": "fe9e83ca-8af2-11e8-a5e2-b9d7a9e128fc",
    "body": {
      "namespace": "tradle:lambda:genericJobRunner",
      "msg": "request context",
      "level": "INFO",
      "details": {
        "seq": 16,
        "requestId": "fe9e83ca-8af2-11e8-a5e2-b9d7a9e128fc",
        "correlationId": "fe9e83ca-8af2-11e8-a5e2-b9d7a9e128fc",
        "containerId": "Andi Woodie Gavrielle fe52c47af47d",
        "commit": "74ad1e04",
        "start": 1531963689405,
        "botReady": true,
        "trace-id": "Parent=5ff0394e26a55bf0"
      }
    }
  },
  {
    "requestId": "fe9e83ca-8af2-11e8-a5e2-b9d7a9e128fc",
    "body": {
      "namespace": "tradle:genericJobRunner",
      "msg": "running job: retryDelivery",
      "level": "DEBUG"
    }
  },
  {
    "requestId": "fe9e83ca-8af2-11e8-a5e2-b9d7a9e128fc",
    "body": {
      "namespace": "tradle:mid",
      "msg": "firing",
      "level": "SILLY",
      "details": {
        "event": "job:retryDelivery"
      }
    }
  },
  {
    "requestId": "fe9e83ca-8af2-11e8-a5e2-b9d7a9e128fc",
    "body": {
      "namespace": "tradle:db",
      "msg": "DB.find tradle.DeliveryError",
      "level": "SILLY",
      "details": {
        "tags": [
          "perf"
        ],
        "success": true,
        "time": 97
      }
    }
  },
  {
    "requestId": "fe9e83ca-8af2-11e8-a5e2-b9d7a9e128fc",
    "body": {
      "namespace": "tradle:lambda:genericJobRunner",
      "msg": "preparing for exit",
      "level": "DEBUG",
      "details": {
        "requestTime": 106,
        "timeLeft": 299893
      }
    }
  },
  {
    "requestId": "fe9e83ca-8af2-11e8-a5e2-b9d7a9e128fc",
    "body": {
      "namespace": "tradle:async-tasks",
      "msg": "no async tasks!",
      "level": "SILLY"
    }
  },
  {
    "requestId": "fe9e83ca-8af2-11e8-a5e2-b9d7a9e128fc",
    "body": {
      "namespace": "tradle:lambda:genericJobRunner",
      "msg": "exiting",
      "level": "SILLY"
    }
  },
  {
    "__": "END",
    "requestId": "fe9e83ca-8af2-11e8-a5e2-b9d7a9e128fc"
  },
  {
    "__": "REPORT",
    "requestId": "fe9e83ca-8af2-11e8-a5e2-b9d7a9e128fc",
    "duration": "107.52",
    "billedDuration": "200",
    "memorySize": "256",
    "memoryUsed": "B"
  }
]

test('log parsing', t => {
  const parsed = sampleLog.map(parseLogEntryMessage)
  t.same(parsed, expectedParsed)
  t.equal(parseMessageBody('AWS_XRAY_CONTEXT_MISSING is set. Configured context missing strategy to LOG_ERROR.\n"').__xray__, true)

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
