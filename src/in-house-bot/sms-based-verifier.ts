import buildResource from '@tradle/build-resource'
import { TYPE } from '@tradle/constants'
import {
  IMailer,
  Commander,
  IDeferredCommandParams,
  IPBUser,
  Logger,
  SNSUtils,
  DB,
} from './types'

import * as Templates from './templates'
import Errors from '../errors'
import baseModels from '../models'

const STATUS = 'tradle.Status'
const PHONE_CHECK = 'tradle.PhoneCheck'
const STATUS_MODEL = baseModels[STATUS]
const PHONE_CHECK_MODEL = baseModels[PHONE_CHECK]

type SMSBasedVerifierOpts = {
  db: DB
  sns: SNSUtils
  commands: Commander
  logger: Logger
}

interface IResultPageOpts {
  title: string
  body: string
  signature?: string
}

interface ISMSOpts {
  phoneNumber: string
  message: string
}

interface IsPhoneCheckPendingOpts {
  user: IPBUser
  phoneNumber: string
}

export const TTL = {
  s: 10 * 60,
  ms: 10 * 60 * 1000
}

export class SMSBasedVerifier {
  private db: DB
  private sns: SNSUtils
  private commands: Commander
  private logger: Logger
  constructor({ db, sns, commands, logger }: SMSBasedVerifierOpts) {
    if (!commands) {
      throw new Errors.InvalidInput('expected "commands"')
    }

    this.db = db
    this.sns = sns
    this.commands = commands
    this.logger = logger
  }

  public confirmAndExec = async ({ deferredCommand, phoneNumber, message }: {
    deferredCommand: IDeferredCommandParams
    phoneNumber: string
    message: string
  }) => {
    const code = await this.commands.defer(deferredCommand)
    this.logger.debug('sending SMS to confirm command', { command: deferredCommand })
    await this.sns.sendSMS({ phoneNumber, message })
    return code
  }

  public processConfirmationCode = async (code: string) => {
    const res = await this.commands.execDeferred(code)
    if (res.error) {
      throw res.error
    }
  }

  public hasUserVerifiedPhoneNumber = async ({ user, phoneNumber }: {
    user: IPBUser
    phoneNumber: string
  }) => {
    try {
      await this.getLatestCheck({ user, phoneNumber, statuses: ['pass'] })
      return true
    } catch (err) {
      Errors.ignoreNotFound(err)
      return false
    }
  }

  public isCheckPending = async ({
    user,
    phoneNumber
  }: IsPhoneCheckPendingOpts) => {
    try {
      const { pending } = await this.getLatestCheck({ user, phoneNumber })
      return pending
    } catch (err) {
      Errors.ignoreNotFound(err)
      return false
    }
  }

  public getLatestCheck = async ({ user, phoneNumber, statuses }: {
    phoneNumber: string
    user: IPBUser
    statuses?: string[]
  }) => {
    if (!(user || phoneNumber)) {
      throw new Error('expected "user" or "phoneNumber"')
    }

    const filter:any = {
      EQ: {
        [TYPE]: PHONE_CHECK
      },
      IN: {},
      STARTS_WITH: {}
    }

    if (user) {
      filter.STARTS_WITH['user.id'] = user.identity._permalink
    }

    if (phoneNumber) {
      filter.EQ.phoneNumber = phoneNumber
    }

    if (statuses) {
      filter.IN['status.id'] = statuses.map(getStatusId)
    }

    const check = await this.db.findOne({
      orderBy: {
        property: '_time',
        desc: true
      },
      filter
    })

    const { status, dateExpires } = check
    const expired = Date.now() > dateExpires
    return {
      check,
      pending: !status && !expired,
      passed: status && status.id.endsWith('pass'),
      failed: status && status.id.endsWith('fail'),
      errored: status && status.id.endsWith('error'),
      expired
    }
  }
}

const textToBlocks = str => str
  .split('\n')
  .map(body => ({ body }))

const getStatusId = value => buildResource.enumValue({
  model: STATUS_MODEL,
  value
}).id
