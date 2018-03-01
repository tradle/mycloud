import _ = require('lodash')
import { TYPE } from '@tradle/constants'
import { isPromise } from '../utils'
import { createConf } from './configure'
import Errors = require('../errors')
import models = require('../models')
import { Name, ResourceStub, ICommand, Bot } from './types'

const SEAL_MODEL_PROPS = Object.keys(models['tradle.Seal'].properties)
const MONTHS = [ 'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec' ]
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const NAME = 'tradle.Name'
const PHOTO_ID = 'tradle.PhotoID'
const ONFIDO_APPLICANT = 'tradle.onfido.Applicant'
const BASIC_CONTACT_INFO = 'tradle.BasicContactInfo'
const PERSONAL_INFO = 'tradle.PersonalInfo'
const ADDRESS = 'tradle.Address'
const BUSINESS_INFORMATION = 'tradle.BusinessInformation'
const IDENTIFICATION_OF_BENEFICIAL_OWNER = 'tradle.W8BENE1'
const DEPLOYMENT_CONFIGURATION = 'tradle.cloud.Configuration'

export const createEditConfOp = edit => async (opts) => {
  const { bot } = opts.commander
  const botConf = opts.commander.conf.bot
  const current = _.cloneDeep(botConf)
  let makeEdit = edit(opts)
  if (isPromise(makeEdit)) makeEdit = await makeEdit

  if (_.isEqual(botConf, current)) {
    throw new Error('you changed...nothing')
  }

  const confManager = createConf({ bot })
  await confManager.setBotConf(botConf)
  await bot.forceReinitializeContainers()
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

// TODO: this really belongs in some middleware, e.g.
// bot.hook('readseals', sendConfirmedSeals)
export const sendConfirmedSeals = async (bot, seals) => {
  const confirmed = seals.filter(s => s.unconfirmed == null && s.counterparty)
  if (!confirmed.length) return

  await bot.send(confirmed.map(seal => ({
    to: seal.counterparty,
    object: {
      [TYPE]: 'tradle.Seal',
      ..._.pick(seal, SEAL_MODEL_PROPS)
    }
  })))
}

export const getDateOfBirthFromForm = (form:any):number|void => {
  const type = form[TYPE]
  if (type === PHOTO_ID) {
    const { scanJson={} } = form
    const { personal={} } = scanJson
    let { dateOfBirth } = personal
    if (typeof dateOfBirth === 'number') {
      return dateOfBirth
    }

    if (form.documentType.id.endsWith('license')) {
      // "birthData": "03/11/1976 UNITED KINGOOM"
      const { birthData } = personal
      if (!birthData) return

      dateOfBirth = birthData.split(' ')[0]
    }

    if (typeof dateOfBirth === 'string') {
      return parseScannedDate(dateOfBirth)
    }
  }
}

export const getFormattedNameFromForm = (form: any):string|void => {
  const personal = getNameFromForm(form)
  if (personal) {
    return [personal.firstName, personal.lastName].filter(str => str).join(' ')
  }

  switch (form[TYPE]) {
    case BUSINESS_INFORMATION:
      return form.companyName
    case IDENTIFICATION_OF_BENEFICIAL_OWNER:
    case DEPLOYMENT_CONFIGURATION:
      return form.name
    default:
      return
  }
}

export const getNameFromForm = (form:any):Name|void => {
  let firstName, lastName
  const type = form[TYPE]
  if (type === BASIC_CONTACT_INFO || type === PERSONAL_INFO) {
    ({ firstName, lastName } = form)
  } else if (type === NAME || type === ONFIDO_APPLICANT) {
    firstName = form.givenName
    lastName = form.surname
  } else if (type === PHOTO_ID) {
    let { scanJson } = form
    if (scanJson) {
      if (typeof scanJson === 'string') {
        scanJson = JSON.parse(scanJson)
      }

      const { personal={} } = scanJson
      if (personal) {
        ({ firstName, lastName } = personal)
      }
    }
  } else {
    return
  }

  if (firstName && lastName) {
    return {
      firstName: maybeCapitalizeWords(firstName),
      lastName: maybeCapitalizeWords(lastName)
    }
  }
}

export const getCountryFromForm = (form:any):ResourceStub => {
  const type = form[TYPE]
  switch (type) {
  case PHOTO_ID:
  case PERSONAL_INFO:
  case ADDRESS:
    return form.country
  }
}

const maybeCapitalizeWords = str => {
  if (str.toUpperCase() === str || str.toLowerCase() === str) {
    return str.split(/\s+/).map(str => _.capitalize(str)).join(' ')
  }

  return str
}

export const parseScannedDate = str => {
  const parts = getDateParts(str)
  if (parts) {
    const { year, month, day } = parts
    return Date.UTC(year, month, day)
  }
}

export const toISODateString = (date:number|string) => {
  if (typeof date !== 'number') {
    if (ISO_DATE.test(date)) return date

    date = parseScannedDate(date)
  }

  if (date) return new Date(date).toISOString().slice(0, 10)
}

const getDateParts = str => {
  if (ISO_DATE.test(str)) {
    const [year, month, day] = str.split('-').map(str => Number(str))
    return {
      year,
      month: month - 1,
      day
    }
  }

  // dd/mm/yyyy
  const euType1 = str.match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/)
  if (euType1) {
    let [day, month, year] = euType1.slice(1).map(n => Number(n))
    if (month > 12) {
      // oof, guesswork
      [day, month] = [month, day]
    }

    if (year < 100) {
      year = Number('19' + year)
    }

    return {
      year,
      month: month - 1,
      day
    }
  }

  // Date in UK looks like this: Jan 16th, 2020
  const euType2 = str.match(/(\w{3})?\s(\d{1,2})\w{2},\s(\d{4})/)
  if (euType2) {
    const [monthAbbr, day, year] = euType2.slice(1)
    return {
      year: Number(year),
      month: MONTHS.indexOf(monthAbbr.toLowerCase()),
      day: Number(day)
    }
  }
}

export const getAppLinks = ({ bot, host, permalink }: {
  bot: Bot
  host?: string
  permalink: string
}) => {
  if (!host) host = bot.apiBaseUrl

  const [mobile, web] = ['mobile', 'web'].map(platform => bot.appLinks.getChatLink({
    provider: permalink,
    host,
    platform
  }))

  const employeeOnboarding = bot.appLinks.getApplyForProductLink({
    provider: permalink,
    host,
    product: 'tradle.EmployeeOnboarding',
    platform: 'web'
  })

  return {
    mobile,
    web,
    employeeOnboarding
  }
}

export const getAppLinksInstructions = ({ mobile, web, employeeOnboarding }) => {
  return `Add it to your Tradle mobile app using [this link](${mobile})

Add it to your Tradle web app using [this link](${web})

Invite employees using [this link](${employeeOnboarding})`
}
