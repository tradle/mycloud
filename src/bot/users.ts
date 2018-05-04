// const Cache = require('lru-cache')
import { EventEmitter } from 'events'
import _ from 'lodash'
import { FindOpts } from '@tradle/dynamodb'
import { TYPE } from '@tradle/constants'
import { getUpdateParams } from '../db-utils'
import Errors from '../errors'
import { Bot } from '../types'
import { topics } from '../events'

const PRIMARY_KEY = 'uid'
const MAPPED_PRIMARY_KEY = 'id'
const USER = 'tradle.products.Customer'

export = function createUsers ({ bot }: { bot: Bot }) {
  const ee = new EventEmitter()
  const { db } = bot

  // const cache = new Cache({ max: 200 })
  const fromDBFormat = user => ({
    ..._.omit(user, [PRIMARY_KEY, TYPE]),
    id: user[PRIMARY_KEY]
  })

  const toDBFormat = user => ({
    ..._.omit(user, MAPPED_PRIMARY_KEY),
    [TYPE]: USER,
    uid: user[MAPPED_PRIMARY_KEY]
  })

  const save = async (user) => {
    await db.put(toDBFormat(user))
    return user
  }

  const del = async (primaryKey) => {
    const user = await db.del({
      [TYPE]: USER,
      [PRIMARY_KEY]: primaryKey
    }, {
      ReturnValues: 'ALL_OLD'
    })

    return fromDBFormat(user)
  }

  const merge = async (user) => {
    const stored = await db.update(toDBFormat(user), { ReturnValues: 'ALL_NEW' })
    return fromDBFormat(stored)
  }

  const createIfNotExists = async (user) => {
    try {
      return await get(user[MAPPED_PRIMARY_KEY])
    } catch (err) {
      Errors.ignoreNotFound(err)
      await save(user)
      await bot.fire(topics.user.create, { user })
      return user
    }
  }

  const get = async (primaryKey) => {
    // bot.logger.silly('getting user', {
    //   stack: new Error('ignore').stack,
    //   id: primaryKey
    // })

    const stored = await db.get({
      [TYPE]: USER,
      [PRIMARY_KEY]: primaryKey
    }, {
      ConsistentRead: true
    })

    return fromDBFormat(stored)
  }

  const list = async (opts: FindOpts) => {
    const { items } = await db.find(_.merge({
      allowScan: true,
      filter: {
        EQ: {
          [TYPE]: USER
        }
      }
    }, opts))

    return items.map(fromDBFormat)
  }

  return _.extend(ee, {
    get,
    createIfNotExists,
    save,
    del,
    merge,
    list
  })
}
