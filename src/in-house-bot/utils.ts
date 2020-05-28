import { parse as parseUrl } from 'url'
import _ from 'lodash'
import { isEmployee } from '@tradle/bot-employee-manager'
import validateResource from '@tradle/validate-resource'
import buildResource from '@tradle/build-resource'
import { get, isPromise, pickNonNull, getEnumValueId, parseStub, getSealBasePubKey } from '../utils'
import { createConf } from './configure'
import Errors from '../errors'
import models from '../models'
import {
  Name,
  ResourceStub,
  Bot,
  IPBAppStub,
  IPBUser,
  ApplicationSubmission,
  Seal,
  IPBReq,
  Models,
  ITradleCheck,
  ITradleObject,
  IConfComponents,
  IUser,
  IPBApp,
  Applications
} from './types'

import { TYPE } from '../constants'
import { TRADLE } from './constants'
import { safeStringify, trimLeadingSlashes, trimTrailingSlashes } from '../string-utils'
import { logger } from '@tradle/dynamodb/lib/defaults'

const SealModel = models['tradle.Seal']
const SEAL_MODEL_PROPS = Object.keys(SealModel.properties)
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
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
const CHECK_STATUS = 'tradle.Status'
const HAND_SIGNATURE = 'tradle.HandSignature'
const APPLICATION = 'tradle.Application'
const SANCTIONS_CHECK = 'tradle.SanctionsCheck'

export { isEmployee }

export const createEditConfOp = (edit) => async (opts) => {
  const { bot } = opts.commander
  const botConf = opts.commander.conf.bot
  const current = _.cloneDeep(botConf)
  let makeEdit = edit(opts)
  if (isPromise(makeEdit)) makeEdit = await makeEdit

  if (_.isEqual(botConf, current)) {
    throw new Error('you changed...nothing')
  }

  const confManager = createConf({ bot })
  await confManager.setBotConf({ bot: botConf })
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

export const toggleProduct = createEditConfOp(
  async ({
    commander,
    req,
    product,
    enable
  }: {
    commander
    req: any
    product: string
    enable: boolean
  }) => {
    const { bot, productsAPI, conf } = commander
    const { products, models } = productsAPI

    // allow to use title
    const byTitle = Object.keys(models.all).filter(
      (id) => models.all[id].title.toLowerCase() === product.toLowerCase()
    )

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
      : products.filter((id) => id !== product)

    conf.bot.products.enabled = newProductsList
  }
)

// TODO: this really belongs in some middleware, e.g.
// bot.hook('readseals', sendConfirmedSeals)
export const sendConfirmedSeals = async (bot: Bot, seals: Seal[]) => {
  if (!seals.length) return

  const confirmed = seals.filter((s) => s.unconfirmed == null && s.counterparty)
  bot.logger.debug(`actually sending ${confirmed.length} confirmed seals`)
  if (!confirmed.length) return

  await bot.send(confirmed.map(sealToSendOpts))
}

const sealToSendOpts = (seal) => {
  const object: ITradleObject = pickNonNull({
    ..._.pick(seal, SEAL_MODEL_PROPS),
    [TYPE]: SealModel.id,
    time: seal._time || Date.now()
  })

  if (seal.basePubKey) {
    const basePubKey = getSealBasePubKey(seal)
    if (basePubKey) object.basePubKey = basePubKey
  }

  return {
    to: seal.counterparty,
    object
  }
}

export const getFormattedNameFromForm = (form: any): string | void => {
  const personal = getNameFromForm(form)
  if (personal) {
    return [personal.firstName, personal.lastName].filter((str) => str).join(' ')
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

export const getNameFromForm = (form: any): Name | void => {
  let firstName, lastName
  const type = form[TYPE]
  if (type === BASIC_CONTACT_INFO || type === PERSONAL_INFO) {
    ;({ firstName, lastName } = form)
  } else if (type === NAME || type === ONFIDO_APPLICANT) {
    firstName = form.givenName
    lastName = form.surname
  } else if (type === PHOTO_ID) {
    let { scanJson, uploaded } = form
    if (scanJson) {
      if (typeof scanJson === 'string') {
        scanJson = JSON.parse(scanJson)
      }

      const { personal = {} } = scanJson
      if (personal) {
        ;({ firstName, lastName } = personal)
      }
    } else if (uploaded) {
      ;({ firstName, lastName } = form)
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

export const getCountryFromForm = (form: any): ResourceStub => {
  const type = form[TYPE]
  switch (type) {
    case PHOTO_ID:
    case PERSONAL_INFO:
    case ADDRESS:
      return form.country
    default:
      return
  }
}

const maybeCapitalizeWords = (str) => {
  if (str.toUpperCase() === str || str.toLowerCase() === str) {
    return str
      .split(/\s+/)
      .map((str) => _.capitalize(str))
      .join(' ')
  }

  return str
}

export const parseScannedDate = (str) => {
  const parts = getDateParts(str)
  if (parts) {
    const { year, month, day } = parts
    return Date.UTC(year, month, day)
  }
}

export const toISODateString = (date: number | string) => {
  if (typeof date !== 'number') {
    if (ISO_DATE.test(date)) return date

    date = parseScannedDate(date)
  }

  if (date) return new Date(date).toISOString().slice(0, 10)
}

const getDateParts = (str) => {
  if (ISO_DATE.test(str)) {
    const [year, month, day] = str.split('-').map((str) => Number(str))
    return {
      year,
      month: month - 1,
      day
    }
  }

  // dd/mm/yyyy
  const euType1 = str.match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/)
  if (euType1) {
    let [day, month, year] = euType1.slice(1).map((n) => Number(n))
    if (month > 12) {
      // oof, guesswork
      ;[day, month] = [month, day]
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

export const getAppLinks = ({
  bot,
  host,
  permalink
}: {
  bot: Bot
  host?: string
  permalink: string
}) => {
  if (!host) host = bot.apiBaseUrl

  const [mobile, web] = ['mobile', 'web'].map((platform) =>
    bot.appLinks.getChatLink({
      provider: permalink,
      host,
      platform
    })
  )

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

export const getAppLinksInstructions = ({
  mobile,
  web,
  employeeOnboarding
}: {
  mobile?: string
  web?: string
  employeeOnboarding?: string
}) => {
  const lines = []
  if (mobile) {
    lines.push(`Add it to your Tradle mobile app using [this link](${mobile})`)
  }

  if (web) {
    lines.push(`Add it to your Tradle web app using [this link](${web})`)
  }

  if (employeeOnboarding) {
    lines.push(`Invite employees using [this link](${employeeOnboarding})`)
  }

  return lines.join('\n\n')
}

const hasApplication = (stubs, application) => {
  return stubs.find((stub) => stub.statePermalink === application._permalink)
}

const judgedStatuses = ['approved', 'denied']

export const isPendingApplication = ({ user, application }) => {
  return (
    !judgedStatuses.includes(application.status) &&
    hasApplication(user.applications || [], application)
  )
}

export const getApplicationStatus = ({ user, application }) => {
  if (hasApplication(user.applicationsApproved || [], application)) return 'approved'
  if (hasApplication(user.applicationsDenied || [], application)) return 'denied'

  return 'pending'
}

export const getNonPendingApplications = (user: IPBUser) => {
  return getApplications({ user, pending: false })
}

export const getApplications = ({
  user,
  pending = true,
  approved = true,
  denied = true
}: {
  user: IPBUser
  pending?: boolean
  approved?: boolean
  denied?: boolean
}): IPBAppStub[] => {
  return ((pending && user.applications) || [])
    .concat((approved && user.applicationsApproved) || [])
    .concat((denied && user.applicationsDenied) || [])
}

export const isPassedCheck = ({ status }) => {
  if (!status) return false

  const id = getEnumValueId({
    model: models[CHECK_STATUS],
    value: status
  })

  return id == 'pass'
}

export const getPropertyTitle = validateResource.utils.getPropertyTitle
export { getEnumValueId }

export const getFormStubs = ({ forms }: { forms?: ApplicationSubmission[] }) =>
  (forms || []).map((appSub) => appSub.submission)

export const getParsedFormStubs = ({ forms }: { forms?: ApplicationSubmission[] }) =>
  getFormStubs({ forms }).map(parseStub)

export const getLatestForms = ({ forms }: { forms?: ApplicationSubmission[] }) => {
  const parsed = getParsedFormStubs({ forms }).reverse()
  return _.uniqBy(parsed, 'type')
}

export const isSubClassOf = (subType, formModel, models) => {
  const sub = formModel.subClassOf
  if (sub === subType) return true
  if (sub && models[sub].abstract) return isSubClassOf(subType, models[sub], models)
}

// Checks will be executed in case of a new resource. If the resource was modified,
// the checks will be executed only if the properties used for verification changed.
// returns either mapped resource or undefined if no verification needed.
export const getCheckParameters = async ({
  plugin,
  resource,
  bot,
  map,
  defaultPropMap
}: {
  plugin: string
  resource: any
  bot: Bot
  map?: any
  defaultPropMap: any
}) => {
  let dbRes
  try {
    dbRes = resource._prevlink && (await bot.objects.get(resource._prevlink))
  } catch (error) {
    console.log('getCheckParameters ', error)
  }
  let runCheck = !dbRes
  let r: any = {}
  // Use defaultPropMap for creating mapped resource if the map was not supplied or
  // if not all properties listed in map - that is allowed if the prop names are the same as default
  for (let prop in defaultPropMap) {
    let p = map && map[prop]
    if (!p) p = prop
    let pValue = resource[p]
    if (dbRes && dbRes[p] !== pValue) runCheck = true
    if (pValue) r[prop] = pValue
  }
  if (!runCheck) return {}
  if (!Object.keys(r).length) return { error: `no criteria to run ${plugin} checks` }
  return runCheck && { resource: r }
}
export const getLatestCheck = async ({
  type,
  req,
  application,
  bot
}: {
  type: string
  req?: IPBReq
  application: IPBApp
  bot: Bot
}) => {
  // if (req && req.latestChecks) return req.latestChecks.find(check => check[TYPE] === type)

  let latestChecks, payload
  if (req) {
    ;({ payload, latestChecks } = req)
    // if (!latestChecks) ({ latestChecks } = await getLatestChecks({ application, bot }))
    if (latestChecks) {
      latestChecks = latestChecks.sort((a, b) => b._time - a._time)
      return latestChecks.find(
        (check) =>
          check[TYPE] === type && (!payload || payload._permalink === check.form._permalink)
      )
    }
  }
  let checkStubs =
    application.checks && application.checks.filter((checkStub) => checkStub[TYPE] === type)
  if (!checkStubs) return
  let checks: any = await Promise.all(checkStubs.map((checkStub) => bot.getResource(checkStub)))
  latestChecks = checks.slice().sort((a, b) => b._time - a._time)
  return latestChecks.find(
    (check) => check[TYPE] === type && (!payload || payload._permalink === check.form._permalink)
  )
}
export const doesCheckNeedToBeCreated = async ({
  bot,
  type,
  application,
  provider,
  form,
  propertiesToCheck,
  prop,
  isCaseSensitive,
  req
}: {
  bot: Bot
  type: string
  application: IPBApp
  provider: string
  form: ITradleObject
  propertiesToCheck: string[]
  prop: string
  isCaseSensitive?: boolean
  req: IPBReq
}) => {
  // debugger
  if (!application.checks || !application.checks.length) return {needsCheck: true }
  if (!req.checks) {
    let startTime = Date.now()
    let { checks = [], latestChecks = [] } = await getLatestChecks({ application, bot })
    _.extend(req, { checks, latestChecks })
    bot.logger.debug(`getChecks took: ${Date.now() - startTime}`)
  }
  let items = req.checks.filter((check) => check.provider === provider)
  // let items = await getChecks({ bot, type, application, provider })
  if (!items.length) return { needsCheck: true }

  let checks = items.filter((r) => r[prop]._link === form._link)
  if (checks.length) return false
  let { needsCheck, notMatched } = await getChangedProperties({ resource: form, bot, propertiesToCheck, req })
  if (needsCheck ) return { needsCheck, notMatched }
  let checkForThisForm = items.filter((r) => r[prop]._permalink === form._permalink)
  if (!checkForThisForm.length) return { needsCheck: true, notMatched }
  checkForThisForm.sort((a, b) => b._time - a._time)
  if (checkForThisForm[0].status.id.endsWith('_error')) return { needsCheck: true, notMatched }
}
export const getLatestChecks = async ({ application, bot }) => {
  if (!application.checks || !application.checks.length) return {}
  let checks: any[] = await Promise.all(
    application.checks.map((stub) => bot.getLatestResource(stub))
  )

  const checksSorted: ITradleCheck[] = checks.sort((a, b) => b._time - a._time)

  let latestChecks: ITradleCheck[] = _.uniqBy(checksSorted, (check: any) =>
    [check.form._permalink, check.propertyName, check[TYPE], check.provider].join(',')
  )

  return { latestChecks, checks }
}

export const getChecks = async ({
  bot,
  type,
  application,
  provider
}: {
  bot: Bot
  type: string
  application: IPBApp
  provider?: string
}) => {
  // debugger
  let eqClause = {
    [TYPE]: type,
    'application._permalink': application._permalink
  }
  if (provider) _.extend(eqClause, { provider })
  const { items } = await bot.db.find({
    allowScan: true,
    orderBy: {
      property: 'dateChecked',
      desc: true
    },
    filter: {
      EQ: eqClause,
      NEQ: {
        'status.id': 'tradle.Status_error'
      }
    }
  })
  return items
}

export const hasPropertiesChanged = async ({
  resource,
  bot,
  propertiesToCheck,
  req,
  isCaseSensitive
}: {
  resource: ITradleObject
  bot: Bot
  propertiesToCheck: string[]
  req: IPBReq
  isCaseSensitive?: boolean
}) => {
  let { notMatched, needsCheck } = await getChangedProperties({resource, bot, propertiesToCheck, isCaseSensitive, req})
  return needsCheck
}
export const getChangedProperties = async ({
  resource,
  bot,
  propertiesToCheck,
  isCaseSensitive,
  req
}: {
  resource: ITradleObject
  bot: Bot
  propertiesToCheck: string[]
  isCaseSensitive?: boolean
  req: IPBReq
}) => {
  // debugger
  if (!resource._prevlink) return { needsCheck: true }
  let dbRes = req.previousPayloadVersion
  if (!dbRes) {
    try {
      dbRes = await bot.objects.get(resource._prevlink)
    } catch (err) {
      bot.logger.debug(
        `not found previous version for the resource - check if this was refresh: ${JSON.stringify(
          resource,
          null,
          2
        )}`
      )
      debugger
      return { needsCheck: true }
    }
    req.previousPayloadVersion = dbRes
  }
  if (!dbRes) return { needsCheck: true }
  let r: any = {}
  // Use defaultPropMap for creating mapped resource if the map was not supplied or
  // if not all properties listed in map - that is allowed if the prop names are the same as default
  let notMatched = {}
  propertiesToCheck.forEach((p) => {
    let rValue = resource[p]
    let dbValue = dbRes[p]
    if (!rValue  &&  !dbValue) return
    if (!rValue  ||  !dbValue) {
      notMatched[p] = dbValue
      return
    }
    // if (rValue === dbValue) return
    if (!isCaseSensitive  && typeof rValue === 'string') {
      if (dbValue.toLowerCase() === rValue.toLowerCase()) return
    }
    if (_.isEqual(dbValue, rValue)) return
    notMatched[p] = dbValue
  })

  if (_.size(notMatched)) return { needsCheck: true, notMatched }
  return {}
}

export const getUserIdentifierFromRequest = (req: IPBReq) => {
  const { user, message } = req
  const { originalSender } = message
  let identifier = user.id
  if (originalSender) {
    identifier += ':' + originalSender
  }

  return identifier
}

export const ensureHandSigLast = (forms: string[]) =>
  _.sortBy(forms, [
    (a) => {
      return a === HAND_SIGNATURE ? 1 : 0
    }
  ])

export const getProductModelForCertificateModel = ({ models, certificateModel }) => {
  const parts = certificateModel.id.split('.')
  const last = parts[parts.length - 1]
  if (last.startsWith('My')) {
    parts[parts.length - 1] = last.slice(2)
    const productModelId = parts.join('.')
    return models[productModelId]
  }
}

export const getStatusMessageForCheck = ({
  models,
  check
}: {
  models: Models
  check: ITradleCheck
}) => {
  const model = models['tradle.Status']
  const { aspects } = check
  const hasManyAspects = Array.isArray(aspects) && aspects.length > 1
  const aspectsStr = typeof aspects === 'string' ? aspects : aspects.join(', ')
  let status: string
  if (check.status) {
    status = getEnumValueId({
      model,
      value: check.status
    })
  } else {
    status = 'pending'
  }

  let prefix
  if (hasManyAspects) prefix = 'One or more checks'
  else prefix = 'Check'

  // switch (status) {
  //   case 'pending':
  //     return `${prefix} pending: ${aspects}`
  //   case 'fail':
  //     return `${prefix} failed: ${aspects}`
  //   case 'error':
  //     return `${prefix} hit an error: ${aspects}`
  //   case 'pass':
  //     return `${prefix} passed: ${aspects}`
  //   case 'warning':
  //     return `${prefix} has a warning: ${aspects}`
  //   default:
  //     throw new Errors.InvalidInput(`unsupported check status: ${safeStringify(check.status)}`)
  // }
  switch (status) {
    case 'pending':
    case 'fail':
    case 'error':
    case 'pass':
    case 'warning':
      return `${aspectsStr}`
    default:
      throw new Errors.InvalidInput(`unsupported check status: ${safeStringify(check.status)}`)
  }
}

export const witness = async (bot: Bot, object: ITradleObject) => {
  // TODO:
  // witness() needs to be called on the original object (with embeds resolved)
  // this is very inefficient, we just saved this object!
  // need to allow this to be plugged in earlier in the process
  const embeds = bot.embeds.getEmbeds(object)

  let copy = _.cloneDeep(object)
  await bot.embeds.resolveAll(copy)
  copy = await bot.witness(copy)

  // set embeds back
  if (embeds.length) {
    embeds.forEach(({ path, value }) => {
      _.set(copy, path, value)
    })
  }

  // check if witness verifies
  // await bot.identities.verifyOrgAuthor(object)

  await bot.save(copy)
  return copy
}

export const isProbablyTradle = ({ org }) => {
  return org.name.toLowerCase() === TRADLE.ORG_NAME.toLowerCase()
}

export const getTradleBotPermalink = async () => {
  const identity = await getTradleBotIdentity()
  return buildResource.permalink(identity)
}

export const getTradleBotStub = async () => {
  const identity = await getTradleBotIdentity()
  return buildResource.stub({ resource: identity })
}

export const getTradleBotIdentity = async () => {
  const info = await get(`${TRADLE.API_BASE_URL}/info`)
  return info.bot.pub
}

const trailingSlashesRegex = /\/+$/
const pathsEqual = (a: string, b: string) => {
  return a.replace(trailingSlashesRegex, '') === b.replace(trailingSlashesRegex, '')
}

export const urlsFuzzyEqual = (a: string, b: string) => {
  const aParsed = parseUrl(a)
  const bParsed = parseUrl(b)
  return aParsed.host === bParsed.host && pathsEqual(aParsed.pathname, bParsed.pathname)
}

interface ThirdPartyServiceInfo {
  apiUrl?: string
  apiKey?: string
}

export const getThirdPartyServiceInfo = (
  conf: Partial<IConfComponents>,
  name: string
): ThirdPartyServiceInfo => {
  const ret: ThirdPartyServiceInfo = {}
  const { kycServiceDiscovery } = conf
  if (!kycServiceDiscovery) return ret

  let { apiKey, services } = kycServiceDiscovery
  if (!services) return ret

  const service = services[name]
  if (!(service && service.enabled)) return ret

  ret.apiKey = service.apiKey || apiKey
  ret.apiUrl = getServiceApiUrl(conf, name)
  return ret
}

const getServiceApiUrl = (conf: Partial<IConfComponents>, name: string): string => {
  const { kycServiceDiscovery } = conf
  const override = _.get(kycServiceDiscovery, ['services', name, 'apiUrl'])
  if (override) return override

  let { apiUrl } = kycServiceDiscovery
  if (!apiUrl) return null

  if (!/https?:\/\//.test(apiUrl)) {
    apiUrl = `http://${apiUrl}`
  }

  apiUrl = trimTrailingSlashes(apiUrl)
  const path = trimLeadingSlashes(kycServiceDiscovery.services[name].path)
  return `${apiUrl}/${path}`
}

export const isThirdPartyServiceConfigured = (conf: Partial<IConfComponents>, name: string) => {
  const { apiUrl } = getThirdPartyServiceInfo(conf, name)
  return !!apiUrl
}

export const ensureThirdPartyServiceConfigured = (conf: IConfComponents, name: string) => {
  if (!isThirdPartyServiceConfigured(conf, name)) {
    throw new Errors.InvalidInput(`you're not running a "${name}" service!`)
  }
}

export const removeRoleFromUser = (user: IUser, role: string) => {
  const { roles } = user
  if (roles) {
    const idx = roles.indexOf(role)
    if (idx !== -1) {
      roles.splice(idx, 1)
      return true
    }
  }

  return false
}

export const didPropChange = ({ old = {}, value, prop }: { old?: any; value: any; prop: string }) =>
  value && (!old || old[prop] !== value[prop])

export const didPropChangeTo = ({
  old = {},
  value = {},
  prop,
  propValue
}: {
  old?: any
  value: any
  prop: string
  propValue: any
}) => {
  return value && value[prop] === propValue && didPropChange({ old, value, prop })
}

export const getAssociateResources = async ({
  application,
  bot,
  applicationOnly,
  resourceOnly
}: {
  application: IPBApp
  bot: Bot
  applicationOnly?: boolean
  resourceOnly?: boolean
}) => {
  const pr: ITradleObject = await bot.getResource(application.request)
  const { parentApplication, associatedResource } = pr
  if (!parentApplication) return {}
  let parentApp
  if (!resourceOnly)
    parentApp = await bot.getResource({ type: APPLICATION, permalink: parentApplication })
  if (applicationOnly) return { parentApp }
  let [type, hash] = associatedResource.split('_')
  let associatedRes = await bot.getResource({ type, permalink: hash })
  return { associatedRes, parentApp }
}
