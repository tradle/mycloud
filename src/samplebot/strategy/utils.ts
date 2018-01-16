import _ = require('lodash')
import { isPromise } from '../../utils'
import { Conf } from '../configure'
import Errors = require('../../errors')

export const EMPLOYEE_COMMANDS = [
  'help',
  'listproducts',
  'forgetme',
  'setproductenabled',
  // 'setautoverify',
  'setautoapprove',
  'addfriend',
  'tours',
  'message',
  'getconf'
]

export const CUSTOMER_COMMANDS = [
  'help',
  'listproducts',
  'forgetme',
  'tours'
]

export const createEditConfOp = edit => async (opts) => {
  const { bot, conf } = opts.context
  const current = _.cloneDeep(conf)
  let makeEdit = edit(opts)
  if (isPromise(makeEdit)) makeEdit = await makeEdit

  if (_.isEqual(conf, current)) {
    throw new Error('you changed...nothing')
  } else {
    const confManager = new Conf({ bot })
    await confManager.setBotConf(conf)
  }
}

export const setProperty = createEditConfOp(({ context, req, path, value }) => {
  _.set(context.conf, path, value)
})

// export const toggleFlag = createEditConfOp(({ context, req, flag, value }) => {
//   const { conf } = context
//   const path = `products.${flag}`
//   if (_.get(conf, path) === value) {
//     throw new Error('you changed...nothing')
//   }

//   _.set(conf, path, value)
// })

export const toggleProduct = createEditConfOp(async ({ context, req, product, enable }: {
  context,
  req: any,
  product:string,
  enable:boolean
}) => {
  const { bot, productsAPI, conf } = context
  const { products, models } = productsAPI

  // allow to use title
  const byTitle = Object.keys(models.all)
    .filter(id => models.all[id].title.toLowerCase() === product.toLowerCase())

  if (byTitle.length > 2) {
    const choices = byTitle.join('\n')
    const message = `multiple products with title "${product}" found. Re-run using the model id:\n${choices}`
    await context.sendSimpleMessage({ req, message })
  }

  if (byTitle.length) product = byTitle[0]

  if (enable && products.includes(product)) {
    throw new Error(`product ${product} is already enabled!`)
  }

  if (!enable && !products.includes(product)) {
    throw new Error(`product ${product} is not enabled!`)
  }

  const model = models.all[product]
  if (!model) {
    throw new Error(`model not found: ${product}`)
  }

  if (model.subClassOf !== 'tradle.FinancialProduct') {
    throw new Error(`model ${product} is not a tradle.FinancialProduct`)
  }

  const newProductsList = enable
    ? products.concat(product)
    : products.filter(id => id !== product)

  conf.products.enabled = newProductsList
})

export const getAvailableCommands = (ctx) => {
  return ctx.employee ? EMPLOYEE_COMMANDS : CUSTOMER_COMMANDS
}

export const getCommandByName = commandName => {
  let command
  try {
    command = require('./commands')[commandName.toLowerCase()]
  } catch (err) {}

  if (!command) {
    throw new Errors.NotFound(`command not found: ${commandName}`)
  }

  return command
}
