const shallowClone = require('xtend')
const buildResource = require('@tradle/build-resource')
const { NODE_ENV } = process.env
if (NODE_ENV === 'test') {
  const extend = require('xtend/mutable')
  extend(process.env, require('../test/service-map'), shallowClone(process.env))
  console.log(process.env)
}

const debug = require('debug')('λ:samplebot')
const co = require('co').wrap
const coExec = require('co')
const yn = require('yn')
const TYPE = '_t'
const DEPLOYMENT = 'io.tradle.Deployment'
const {
  // PRODUCTS=DEPLOYMENT,
  // PRODUCTS='tradle.CRSSelection,tradle.CoverholderApproval,tradle.MortgageProduct',
  PRODUCTS='nl.tradle.DigitalPassport',
  ORG_DOMAIN,
  AUTO_VERIFY_FORMS,
  AUTO_APPROVE_APPS,
  AUTO_APPROVE_EMPLOYEES=true,
  GRAPHQL_AUTH//=true
} = process.env

const NAMESPACE = ORG_DOMAIN.split('.').reverse().join('.')
const deploymentModels = require('./deployment-models')('io.tradle')
const bankModels = require('./bank-models')(NAMESPACE)
const models = shallowClone(deploymentModels, bankModels)
const products = PRODUCTS.split(',').map(id => id.trim())
const createBot = require('../lib/bot')
const strategies = require('../lib/bot/strategy')
const {
  bot,
  productsAPI,
  employeeManager
} = strategies.products({
  namespace: NAMESPACE,
  models,
  products,
  approveAllEmployees: yn(AUTO_APPROVE_EMPLOYEES),
  autoVerify: yn(AUTO_VERIFY_FORMS),
  autoApprove: yn(AUTO_APPROVE_APPS),
  graphqlRequiresAuth: yn(GRAPHQL_AUTH)
  // handlers: PRODUCT === DEPLOYMENT ? require('./deployment-handlers') : {}
})

// function getProductModelIds (models) {
//   return Object.keys(models).filter(id => models[id].subClassOf === 'tradle.FinancialProduct')
// }

// prepend this hook
bot.hook('message', co(function* ({ user, type }) {
  debug(`received ${type}`)
  if (type === 'tradle.Ping') {
    yield bot.send({
      to: user.id,
      object: {
        [TYPE]: 'tradle.Pong'
      }
    })

    // prevent further processing
    return false
  }
}), true) // prepend

if (PRODUCTS === DEPLOYMENT) {
  productsAPI.plugins.clear('onFormsCollected')
  productsAPI.plugins.use(require('./deployment-handlers'))
} else {
  const biz = require('@tradle/biz-plugins')
  // unshift
  biz.forEach(plugin => productsAPI.plugins.use(plugin(), true))
}

bot.ready()

// if (NODE_ENV === 'test') {
//   const user = require('../lib/bot/tester')({ bot })
//   coExec(function* () {
//     // yield user.sendSelfIntroduction()
//     debugger
//     user.send(buildResource({
//       models: productsAPI.models,
//       model: productsAPI.appModels.application.id,
//       resource: {
//         product: `${productsAPI.appModels.productList.id}_${productsAPI.appModels.productList.enum[0].id}`
//       }
//     }).toJSON())

//     const received = yield user.awaitMessage()
//     console.log(received)
//   })
//   .catch(console.error)
// }

module.exports = createBot.lambdas(bot)

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
