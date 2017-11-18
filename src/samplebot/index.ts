import shallowClone = require('xtend')
import buildResource = require('@tradle/build-resource')
import extend = require('xtend/mutable')
import yn = require('yn')
import createBot from './bot'
import { handler as httpHandler } from '../lambda/http/default'

const { IS_LAMBDA_ENVIRONMENT, NODE_ENV } = process.env
if (NODE_ENV === 'test') {
  Object.assign(process.env, require('../test/service-map'), { ...process.env })
  // console.log(process.env)
}

// locally
if (yn(IS_LAMBDA_ENVIRONMENT) === false) {
  const { env } = require('../cli/serverless-yml').custom.brand
  Object.assign(process.env, env)
}

const debug = require('debug')('λ:samplebot')
const TYPE = '_t'
const {
  bot,
  tradle,
  lambdas,
  productsAPI,
  employeeManager,
  onfidoPlugin
} = createBot({
  ORG_DOMAIN: 'tradle.io',
  AUTO_APPROVE_EMPLOYEES: true,
  ...process.env
})


// function getProductModelIds (models) {
//   return Object.keys(models).filter(id => models[id].subClassOf === 'tradle.FinancialProduct')
// }

// prepend this hook
// bot.hook('message', async ({ user, type }) => {
//   debug(`received ${type}`)
//   if (type === 'tradle.Ping') {
//     await bot.send({
//       to: user.id,
//       object: {
//         [TYPE]: 'tradle.Pong'
//       }
//     })

//     // prevent further processing
//     return false
//   }
// }, true) // prepend

// if (NODE_ENV === 'test') {
//   const user = require('../bot/tester')({ bot })
//   coExec(function* () {
//     // await user.sendSelfIntroduction()
//     debugger
//     user.send(buildResource({
//       models: productsAPI.models,
//       model: productsAPI.appModels.application.id,
//       resource: {
//         product: `${productsAPI.appModels.productList.id}_${productsAPI.appModels.productList.enum[0].id}`
//       }
//     }).toJSON())

//     const received = await user.awaitMessage()
//     console.log(received)
//   })
//   .catch(console.error)
// }

exports = module.exports = lambdas
exports.handleOnfidoWebhookEvent = httpHandler
exports.models = productsAPI.models.all
exports.bot = productsAPI.bot
exports.db = productsAPI.bot.db
exports.tables = productsAPI.bot.db.tables
exports.productsAPI = productsAPI
exports.tradle = tradle

// bot.graphqlAPI.executeQuery(`
//   {
//     rl_tradle_FormRequest {
//       edges {
//         node {
//           _link
//         }
//       }
//     }
//   }
// `, {})

// bot.exports.ongraphql({
//   body: require('graphql').introspectionQuery
// }, {
//   succeed: console.log
// })
