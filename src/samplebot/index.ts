const shallowClone = require('xtend')
const buildResource = require('@tradle/build-resource')
const { IS_LAMBDA_ENVIRONMENT, NODE_ENV } = process.env
const extend = require('xtend/mutable')
const yn = require('yn')
if (NODE_ENV === 'test') {
  extend(process.env, require('../test/service-map'), shallowClone(process.env))
  // console.log(process.env)
}

// locally
if (yn(IS_LAMBDA_ENVIRONMENT) === false) {
  const { env } = require('../cli/serverless-yml').custom.brand
  extend(process.env, env)
}

const debug = require('debug')('λ:samplebot')
const co = require('co').wrap
const coExec = require('co')
const TYPE = '_t'
let {
  // PRODUCTS=DEPLOYMENT,
  // PRODUCTS='tradle.CRSSelection,tradle.CoverholderApproval,tradle.MortgageProduct',
  PRODUCTS,
  ORG_DOMAIN='tradle.io',
  AUTO_VERIFY_FORMS,
  AUTO_APPROVE_APPS,
  AUTO_APPROVE_EMPLOYEES=true,
  GRAPHQL_AUTH//=true
} = process.env

const NAMESPACE = ORG_DOMAIN.split('.').reverse().join('.')
const DEPLOYMENT = `${NAMESPACE}.Deployment`
const deploymentModels = require('./deployment-models')(NAMESPACE)
const bankModels = require('./bank-models')(NAMESPACE)
const models = shallowClone(deploymentModels, bankModels)
const products = PRODUCTS.split(',').map(id => id.trim())
const createBot = require('../bot')
const strategies = require('./strategy')
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

const cacheableConf = bot.resources.buckets.PublicConf.getCacheable({
  key: 'bot-conf.json',
  ttl: 60000,
  parse: JSON.parse.bind(JSON)
})

const getConf = co(function* () {
  try {
    return yield cacheableConf.get()
  } catch (err) {
    return require('./default-conf')
  }
})

const getPluginConf = co(function* (pluginName) {
  const conf = yield getConf()
  const { plugins={} } = conf
  return plugins[pluginName]
})

const customize = co(function* () {
  const customizeMessage = require('@tradle/plugin-customize-message')
  productsAPI.plugins.use(customizeMessage({
    get models () {
      return productsAPI.models.all
    },
    getConf: () => getPluginConf('customize-message'),
    logger: bot.logger
  }))

  if (products.includes(DEPLOYMENT)) {
    // productsAPI.plugins.clear('onFormsCollected')
    productsAPI.plugins.use(require('./deployment-handlers'))
  }

  const biz = require('@tradle/biz-plugins')
  // unshift
  biz.forEach(plugin => productsAPI.plugins.use(plugin({
    bot,
    productsAPI,
    get models () {
      return productsAPI.models.all
    }
  }), true))
})

customize().then(() => bot.ready())

// if (NODE_ENV === 'test') {
//   const user = require('../bot/tester')({ bot })
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

exports = module.exports = createBot.lambdas(bot)
exports.models = productsAPI.models.all
exports.bot = productsAPI.bot
exports.db = productsAPI.bot.db
exports.tables = productsAPI.bot.db.tables
exports.productsAPI = productsAPI

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
