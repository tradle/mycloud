// const Cache = require('lru-cache')
import _ from 'lodash'
import { EventEmitter } from 'events'
import { co } from '../utils'
import { getUpdateParams } from '../db-utils'
import Errors from '../errors'
const PRIMARY_KEY = 'id'

export = function createUsers ({ table, oncreate }) {
  const ee = new EventEmitter()

  // const cache = new Cache({ max: 200 })
  const save = user => table.put({ Item: user }).then(() => user)
  const del = primaryKey => table.del({
    Key: { [PRIMARY_KEY]: primaryKey },
    ReturnValues: 'ALL_OLD'
  })

  const merge = function merge (user) {
    return table.update(_.extend(getUpdateParams(getProps(user)), {
      Key: getKey(user),
      ReturnValues: 'ALL_NEW',
    }))
  }

  const list = table.scan
  const createIfNotExists = co(function* (user) {
    try {
      return yield get(user[PRIMARY_KEY])
    } catch (err) {
      if (err instanceof Errors.NotFound) {
        yield save(user)
        yield oncreate(user)
        return user
      }

      throw err
    }
  })

  const get = primaryKey => table.get({
    Key: { [PRIMARY_KEY]: primaryKey },
    ConsistentRead: true
  })

  return _.extend(ee, {
    get,
    createIfNotExists,
    save,
    del,
    merge,
    list
  })
}

function getKey (user) {
  return _.pick(user, PRIMARY_KEY)
}

function getProps (user) {
  return _.omit(user, PRIMARY_KEY)
}
