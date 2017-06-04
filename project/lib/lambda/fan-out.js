
const debug = require('debug')('tradle:sls:λ:fan-out')
const { marshalItem, unmarshalItem } = require('../db-utils')
const wrap = require('../wrap')
const { groupBy } = require('../utils')
const { invokeForTopic } = require('../lambda-utils')

exports.handler = wrap.generator(function* (event, context) {
  debug('fanning out', event)
  const { Records } = event
  const items = event.Records.map(record => unmarshalItem(record.dynamodb.NewImage))
  const byTopic = groupBy(items, 'topic')
  const invocations = Object.keys(byTopic)
    .map(topic => {
      // const items = byTopic[topic].map(wrapper => wrapper.data)
      const items = byTopic[topic]
      return invokeForTopic(topic, items)
    })

  yield Promise.all(invocations)
})
