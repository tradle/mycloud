import { customize } from './customize'
import { createBot } from '../bot'
import { createHandler } from '../http-request-handler'

// const { IS_LAMBDA_ENVIRONMENT, NODE_ENV } = process.env
// if (NODE_ENV === 'test') {
//   Object.assign(process.env, require('../test/service-map'), { ...process.env })
//   // console.log(process.env)
// }

const bot = createBot()
// for testing
Object.assign(exports, bot.lambdas)
export const promiseCustomized = customize({ bot })

// ;(async () => {
//   const {
//     bot,
//     tradle,
//     lambdas,
//     productsAPI,
//     employeeManager,
//     onfidoPlugin
//   } = await createBot()

//   Object.assign(exports, lambdas)
//   // onfidoPlugin already mounted a handler on the http router
//   exports.handleOnfidoWebhookEvent = createHandler(tradle)
//   exports.models = productsAPI.models.all
//   exports.bot = productsAPI.bot
//   exports.db = productsAPI.bot.db
//   exports.tables = productsAPI.bot.db.tables
//   exports.productsAPI = productsAPI
//   exports.tradle = tradle
// })()

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
