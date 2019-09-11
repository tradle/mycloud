import get from 'lodash/get'
import { TYPE } from '@tradle/constants'
import {
  CreatePlugin,
  ITradleObject,
  IPluginOpts,
  ValidatePluginConf,
  EnumStub,
  IPBReq,
  IPBUser,
  IPBApp,
  UpdateResourceOpts,
  ISMS,
  Bot
} from '../types'
import { SMSBasedVerifier, TTL } from '../sms-based-verifier'
import Errors from '../../errors'
import { topics as EventTopics } from '../../events'
import { randomDigits } from '../../crypto'
import buildResource from '@tradle/build-resource'
import { getStatusMessageForCheck } from '../utils'

const PHONE_CHECK = 'tradle.PhoneCheck'
const OTP = 'tradle.OTP'
const SMS_OTP_PROMPT = `Please enter your SMS confirmation code when you receive it`
const INVALID_OTP = `invalid confirmation code, try again?`
const ASPECTS = 'Phone verification'
const PROVIDER = 'Tradle'
const DEFAULT_SMS_GATEWAY = 'sns'

const createSMSPrompt = (phoneNumber: string) =>
  `Please enter your SMS confirmation code when you receive it at ${phoneNumber}`

interface ISMSForm {
  property: string
  corporate?: boolean
}

interface ISMSProduct {
  [form: string]: ISMSForm
}

interface ISMSProducts {
  [product: string]: ISMSProduct
}

type SMSGatewayName = 'sns'

interface ISMSPluginConf {
  products: ISMSProducts
  gateway?: SMSGatewayName
}

interface ISMSPluginOpts extends IPluginOpts {
  conf: ISMSPluginConf
  smsBasedVerifier: SMSBasedVerifier
}

interface Phone {
  number: string
  phoneType: EnumStub
}

interface RequestPhoneCheckOpts {
  req?: IPBReq
  application?: IPBApp
  user: IPBUser
  phone: Phone
}

interface PhoneCheck extends ITradleObject {
  phone: Phone
  dateExpires: number
}

const isValidPhoneNumber = (number: string) => true
const EXEC_ASYNC = false
const getSMSClient = ({
  bot,
  gateway = DEFAULT_SMS_GATEWAY
}: {
  bot: Bot
  gateway: SMSGatewayName
}): ISMS => {
  if (gateway.toLowerCase() === 'sns') {
    return bot.snsUtils
  }

  throw new Errors.InvalidInput(`SMS gateway "${gateway}" not found`)
}

export const name = 'verify-phone-number'
export const createPlugin: CreatePlugin<SMSBasedVerifier> = (
  { bot, commands, smsBasedVerifier, conf, applications },
  pluginOpts: ISMSPluginOpts
) => {
  const { logger } = pluginOpts
  const pluginConf = pluginOpts.conf as ISMSPluginConf
  const { products } = pluginConf
  if (!smsBasedVerifier) {
    const sms: ISMS = getSMSClient({ bot, gateway: pluginConf.gateway })
    smsBasedVerifier = new SMSBasedVerifier({
      db: bot.db,
      sms,
      commands,
      logger: pluginOpts.logger
    })
  }

  const getPhone = (application: IPBApp, form: ITradleObject): Phone => {
    if (!application) return

    const pConf = get(pluginConf.products, [application.requestFor, form[TYPE]]) as any
    if (!pConf) return

    const { property } = pConf
    const value = form[property]
    return Array.isArray(value) ? value[0] : value
  }

  const shouldCreateCheck = async ({
    user,
    phoneNumber
  }: {
    user: IPBUser
    phoneNumber: string
  }) => {
    let latest
    try {
      latest = await smsBasedVerifier.getLatestCheck({ user, phoneNumber })
    } catch (err) {
      Errors.ignoreNotFound(err)
      return true
    }

    return latest.failed || latest.errored || latest.expired
  }

  const maybeRequestPhoneCheck = async (opts: RequestPhoneCheckOpts) => {
    const { user, phone } = opts
    const keepGoing = true || (await shouldCreateCheck({ user, phoneNumber: phone.number }))
    if (!keepGoing) {
      logger.debug('not creating phone check, already verified or pending', {
        user: user.id,
        phone
      })

      return
    }

    await requestPhoneCheck(opts)
  }

  const requestPhoneCheck = async (opts: RequestPhoneCheckOpts) => {
    const { req, user, application, phone } = opts

    let phoneObj
    if (typeof phone === 'string') {
      phoneObj = {
        number: phone,
        phoneType: buildResource.enumValue({
          model: bot.models['tradle.PhoneTypes'],
          value: 'mobile'
        })
      }
    } else phoneObj = phone
    logger.debug(`creating ${PHONE_CHECK}`, { phoneObj })

    let resource: any = {
      [TYPE]: PHONE_CHECK,
      application,
      phone: phoneObj,
      aspects: ASPECTS,
      status: 'pending',
      provider: PROVIDER,
      // this org
      user: user.identity,
      dateExpires: Date.now() + TTL.ms
    }
    debugger

    resource.message = getStatusMessageForCheck({ models: bot.models, check: resource })
    const createCheck = applications.createCheck(resource, req)

    const requestConfirmationCode = await applications.requestItem({
      req,
      user,
      application,
      message: createSMSPrompt(phoneObj.number),
      item: OTP
    })

    const [check] = await Promise.all([createCheck, requestConfirmationCode])
    if (EXEC_ASYNC) return

    const checkJson = check.toJSON({ validate: false }) as PhoneCheck
    await execPhoneCheck(checkJson)
  }

  const plugin = {
    'onmessage:tradle.Form': async req => {
      const { user, application, payload } = req
      if (payload[TYPE] === OTP) {
        try {
          await smsBasedVerifier.processConfirmationCode(payload.password)
        } catch (err) {
          Errors.rethrow(err, 'developer')
          await applications.requestItem({
            req,
            user,
            application,
            message: INVALID_OTP,
            item: OTP
          })
        }

        return
      }

      const phone = getPhone(application, payload)
      if (!phone) return

      await maybeRequestPhoneCheck({ req, user, application, phone })
    }
  }

  const execPhoneCheck = async (check: PhoneCheck) => {
    const stub = bot.buildStub(check)
    const confirmationCode = randomDigits(5)
    const passCheckParams: UpdateResourceOpts = {
      type: PHONE_CHECK,
      permalink: stub._permalink,
      props: {
        status: 'pass'
      }
    }

    await smsBasedVerifier.confirmAndExec({
      smsOpts: {
        phoneNumber: check.phone.number,
        message: `confirmation code: ${confirmationCode}`,
        senderId: conf.org.name
      },
      deferredCommand: {
        dateExpires: check.dateExpires,
        confirmationCode,
        // ttl: 1, // 1 second
        command: {
          component: 'applications',
          method: 'updateCheck',
          params: passCheckParams
        }
      }
    })
  }

  if (EXEC_ASYNC) {
    bot.hookSimple(EventTopics.resource.save.async, async event => {
      const { value, old } = event
      if (!value) return // this is a 'delete' op
      if (value[TYPE] !== PHONE_CHECK) return
      if (value.status) return

      const botPermalink = await bot.getPermalink()
      if (value._author !== botPermalink) return

      await execPhoneCheck(value as PhoneCheck)
    })
  }

  return {
    api: smsBasedVerifier,
    plugin
  }
}

export const validateConf: ValidatePluginConf = async ({ bot, conf, pluginConf }) => {
  const { products = {}, gateway } = pluginConf as ISMSPluginConf
  const sms: ISMS = getSMSClient({ bot, gateway: pluginConf.gateway })
  for (let product in products) {
    let pConf = products[product]
    for (let form in pConf) {
      let formModel = bot.models[form]
      if (!formModel) {
        throw new Errors.InvalidInput(`model not found: ${form}`)
      }

      let fConf = pConf[form]
      let { property } = fConf
      if (!property) {
        throw new Errors.InvalidInput(
          `expected property name at products['${product}']['${form}'].property`
        )
      }

      if (!formModel.properties[property]) {
        throw new Errors.InvalidInput(`model ${form} has no property: ${property}`)
      }
    }
  }
}
