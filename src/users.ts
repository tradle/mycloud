// const Cache = require('lru-cache')
import { EventEmitter } from 'events'
import _ from 'lodash'
import { FindOpts } from '@tradle/dynamodb'
import { TYPE } from '@tradle/constants'
import { getUpdateParams } from './db-utils'
import Errors from './errors'
import { Bot, DB } from './types'
import { topics } from './events'
import { ensureTimestamped } from './utils'

const PRIMARY_KEY = 'uid'
const MAPPED_PRIMARY_KEY = 'id'
const DEFAULT_TYPE = 'tradle.products.Customer'

type UsersOpts = {
  bot: Bot
  type?: string
}

export default class Users extends EventEmitter {
  private bot: Bot
  private db: DB
  public type: string
  constructor ({ bot, type=DEFAULT_TYPE }: UsersOpts) {
    super()
    this.db = bot.db
    this.bot = bot
    this.type = type
  }

  public save = async (user) => {
    await this.db.put(this._prepareForPut(user))
    return user
  }

  public del = async (primaryKey) => {
    const user = await this.db.del({
      [TYPE]: this.type,
      [PRIMARY_KEY]: primaryKey
    }, {
      ReturnValues: 'ALL_OLD'
    })

    return this._fromDBFormat(user)
  }

  public merge = async (user) => {
    const stored = await this.db.update(this._prepareForPut(user), { ReturnValues: 'ALL_NEW' })
    return this._fromDBFormat(stored)
  }

  public createIfNotExists = async (user) => {
    try {
      return await this.get(user[MAPPED_PRIMARY_KEY])
    } catch (err) {
      Errors.ignoreNotFound(err)
      await this.save(user)
      await this.bot.fire(topics.user.create, { user })
      return user
    }
  }

  public get = async (primaryKey) => {
    // bot.logger.silly('getting user', {
    //   stack: new Error('ignore').stack,
    //   id: primaryKey
    // })

    const stored = await this.db.get({
      [TYPE]: this.type,
      [PRIMARY_KEY]: primaryKey
    }, {
      ConsistentRead: true
    })

    return this._fromDBFormat(stored)
  }

  public list = async (opts: Partial<FindOpts>={}) => {
    const { items } = await this.db.find(_.merge({
      allowScan: true,
      filter: {
        EQ: {
          [TYPE]: this.type
        }
      }
    }, opts))

    return items.map(this._fromDBFormat)
  }

  private _fromDBFormat = user => ({
    ..._.omit(user, [PRIMARY_KEY]),
    id: user[PRIMARY_KEY]
  })

  private _prepareForPut = user => {
    ensureTimestamped(user)
    return {
      ..._.omit(user, MAPPED_PRIMARY_KEY),
      [TYPE]: this.type,
      uid: user[MAPPED_PRIMARY_KEY],
      _time: Date.now()
    }
  }
}

export { Users }
export const createUsers = (opts: UsersOpts) => new Users(opts)
