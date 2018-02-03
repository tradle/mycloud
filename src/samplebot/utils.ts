import _ = require('lodash')
import { TYPE } from '@tradle/constants'
import { isPromise } from '../utils'
import { Conf } from './configure'
import Errors = require('../errors')
import models = require('../models')

const SEAL_MODEL_PROPS = Object.keys(models['tradle.Seal'].properties)

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
  'getconf',
  'approve',
  'deny'
]

export const CUSTOMER_COMMANDS = [
  'help',
  'listproducts',
  'forgetme',
  'tours'
]

export const SUDO_ONLY_COMMANDS = [
  'encryptbucket'
]

export const SUDO_COMMANDS = EMPLOYEE_COMMANDS.concat(SUDO_ONLY_COMMANDS)

export const createEditConfOp = edit => async (opts) => {
  const { bot } = opts.commander
  const botConf = opts.commander.conf.bot
  const current = _.cloneDeep(botConf)
  let makeEdit = edit(opts)
  if (isPromise(makeEdit)) makeEdit = await makeEdit

  if (_.isEqual(botConf, current)) {
    throw new Error('you changed...nothing')
  } else {
    const confManager = new Conf({ bot })
    await confManager.setBotConf(botConf)
    await bot.forceReinitializeContainers()
  }
}

export const setProperty = createEditConfOp(({ commander, req, path, value }) => {
  _.set(commander.conf.bot, path, value)
})

// export const toggleFlag = createEditConfOp(({ commander, req, flag, value }) => {
//   const { conf } = commander
//   const path = `products.${flag}`
//   if (_.get(conf, path) === value) {
//     throw new Error('you changed...nothing')
//   }

//   _.set(conf, path, value)
// })

export const toggleProduct = createEditConfOp(async ({ commander, req, product, enable }: {
  commander,
  req: any,
  product:string,
  enable:boolean
}) => {
  const { bot, productsAPI, conf } = commander
  const { products, models } = productsAPI

  // allow to use title
  const byTitle = Object.keys(models.all)
    .filter(id => models.all[id].title.toLowerCase() === product.toLowerCase())

  if (byTitle.length > 2) {
    const choices = byTitle.join('\n')
    const message = `multiple products with title "${product}" found. Re-run using the model id:\n${choices}`
    await commander.sendSimpleMessage({ req, message })
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

  conf.bot.products.enabled = newProductsList
})

export const getAvailableCommands = (ctx) => {
  if (ctx.sudo) return SUDO_COMMANDS
  if (ctx.employee) return EMPLOYEE_COMMANDS
  return CUSTOMER_COMMANDS
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

export const sendConfirmedSeals = async (bot, seals) => {
  const confirmed = seals.filter(s => s.unconfirmed == null && s.counterparty)
  if (!confirmed.length) return

  await bot.send(seals.map(seal => ({
    to: seal.counterparty,
    object: {
      [TYPE]: 'tradle.Seal',
      ..._.pick(seal, SEAL_MODEL_PROPS)
    }
  })))
}
