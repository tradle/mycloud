const co = require('co').wrap
const Gen = require('@tradle/gen-samples')
const { TYPE } = require('@tradle/constants')
const { batchPut } = require('../db-utils')

module.exports = co(function* ({ bot, event, context }) {
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

  yield Object.keys(byTable).map(co(function* (type) {
    try {
      yield tables[type].batchPut(byTable[type])
    } catch (err) {
      console.error(type, err)
    }
  }))

  return samples
})

function getParams ({ httpMethod, body, queryStringParameters }) {
  if (httpMethod === 'POST') return JSON.parse(body)

  const params = {
    users: Number(queryStringParameters.users),
    products: JSON.parse(queryStringParameters.products)
  }

  return params
}
