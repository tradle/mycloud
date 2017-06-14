const debug = require('debug')('tradle:sls:λ:inbox-events')
const wrap = require('../wrap')
const { unmarshalDBItem } = require('../db-utils')
const { prettify } = require('../utils')
const { onRestoreRequest } = require('../user')
const Events = require('../events')
// const tableToTopic = {
//   InboxTable: 'receive',
//   Outboxtable: 'send',

// }

// replicate Inbox to EventsTable

exports.handler = wrap.generator(function* (event, context) {
  // unmarshalling is prob a waste of time
  const items = event.Records.map(record => unmarshalDBItem(record.dynamodb.NewImage))
  // const { eventSourceARN } = event.Records[0]
  // e.g. arn:aws:dynamodb:us-east-1:210041114155:table/InboxTable/stream/2017-06-06T01:32:10.842
  // const TableName = eventSourceARN.split('/')[1]
  // const topic = tableToTopic[TableName]

  const topic = 'receive'
  items.forEach(item => {
    item.topic = topic
  })

  yield Events.putEvents(items)

  // const clientId = topic.split('/')[0]
  // const { gt, lt } = data
  // yield onRestoreRequest({ clientId, lt, gt })
})
