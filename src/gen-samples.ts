// @ts-ignore (uninstalled for now, as it's not used, and quite heavy)
import Gen from '@tradle/gen-samples'

export = async function genSamples ({ bot, event }) {
  const { TESTING } = bot.env
  const { users, products } = TESTING ? getParams(event) : event
  if (typeof users !== 'number') throw new Error('expected number "users"')

  const { models, db } = bot
  if (!Array.isArray(products)) {
    throw new Error('expected array "products"')
  }

  products.forEach(id => {
    const model = models[id]
    if (!model || model.subClassOf !== 'tradle.FinancialProduct') {
      throw new Error(`${id} is not a FinancialProduct`)
    }
  })

  const gen = Gen.samples({ models })
  const samples = new Array(users).fill(0).map(() => {
    return gen.user({ products })
  })
  // flatten
  .reduce((all, some) => all.concat(some), [])

  await db.batchPut(samples)
  if (TESTING) {
    return {
      statusCode: 200
    }
  }
}

const getParams = ({ httpMethod, body, queryStringParameters }) => {
  if (httpMethod === 'POST') {
    return typeof body === 'string' ? JSON.parse(body) : body
  }

  const params = {
    users: Number(queryStringParameters.users),
    products: JSON.parse(queryStringParameters.products)
  }

  return params
}
