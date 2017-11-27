import dotProp = require('dot-prop')
import clone = require('clone')
import deepEqual = require('deep-equal')
import { isPromise } from '../../utils'
import { Conf } from '../configure'
import Errors = require('../../errors')

export const EMPLOYEE_COMMANDS = [
  'help',
  'listproducts',
  'forgetme',
  'setproductenabled',
  'setautoverify',
  'addfriend'
]

export const CUSTOMER_COMMANDS = [
  'help',
  'listproducts',
  'forgetme'
]

export const createEditConfOp = edit => async (opts) => {
  const { bot, conf } = opts.context
  const current = clone(conf)
  let makeEdit = edit(opts)
  if (isPromise(makeEdit)) makeEdit = await makeEdit

  if (deepEqual(conf, current)) {
    throw new Error('you changed...nothing')
  } else {
    const confManager = new Conf(bot)
    await confManager.savePrivateConf(conf)
  }
}

export const setProperty = createEditConfOp(({ context, req, path, value }) => {
  dotProp.set(context.conf, path, value)
})

// export const toggleFlag = createEditConfOp(({ context, req, flag, value }) => {
//   const { conf } = context
//   const path = `products.${flag}`
//   if (dotProp.get(conf, path) === value) {
//     throw new Error('you changed...nothing')
//   }

//   dotProp.set(conf, path, value)
// })

export const toggleProduct = createEditConfOp(async ({ context, req, product, enable }: {
  context,
  req: any,
  product:string,
  enable:boolean
}) => {
  const { bot, productsAPI, conf } = context
  const { products, models } = productsAPI
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

export const getAvailableCommands = ({ context, req }) => {
  const isEmployee = context.employeeManager.isEmployee(req.user)
  return isEmployee ? EMPLOYEE_COMMANDS : CUSTOMER_COMMANDS
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
