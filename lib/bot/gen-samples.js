const co = require('co').wrap
const Gen = require('@tradle/gen-samples')
const { TYPE } = require('@tradle/constants')
const { batchify } = require('../utils')
const MAX_TABLES_PER_OP = 10

module.exports = co(function* ({ bot, event }) {
  const { users, products } = getParams(event)
  const { models, tables } = bot
  const gen = Gen.samples({ models })
  const samples = new Array(users).fill(0).map(() => {
    return gen.user({ products })
  })
  // flatten
  .reduce((all, some) => all.concat(some), [])

  const byTable = {}
  for (const sample of samples) {
    const type = sample[TYPE]
    if (!byTable[type]) {
      byTable[type] = []
    }

    byTable[type].push(sample)
  }

  const typeBatches = batchify(Object.keys(byTable), MAX_TABLES_PER_OP)

  for (const batch of typeBatches) {
    yield batch.map(co(function* (type) {
      try {
        yield tables[type].batchPut(byTable[type])
      } catch (err) {
        console.error(type, err)
      }
    }))
  }

  return samples
})

function getParams ({ httpMethod, body, queryStringParameters }) {
  if (httpMethod === 'POST') return body

  const params = {
    users: Number(queryStringParameters.users),
    products: JSON.parse(queryStringParameters.products)
  }

  return params
}
