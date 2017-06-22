// const Cache = require('lru-cache')
const { co, pick, omit, extend } = require('../utils')
const { getUpdateParams } = require('../db-utils')
const Errors = require('../errors')
const PRIMARY_KEY = 'id'

module.exports = function createUsers ({ table }) {
  // const cache = new Cache({ max: 200 })
  const save = user => table.put({ Item: user })
  const del = primaryKey => table.del({
    Key: { [PRIMARY_KEY]: primaryKey },
    ReturnValues: 'ALL_OLD'
  })

  const merge = function merge (user) {
    return table.update(extend({
      Key: getKey(user),
      ReturnValues: 'ALL_NEW',
    }, getUpdateParams(getProps(user))))
  }

  const list = table.scan
  const createIfNotExists = co(function* (user) {
    try {
      return yield table.get({
        Key: getKey(user)
      })
    } catch (err) {
      if (err instanceof Errors.NotFound) {
        yield save(user)
        return user
      }

      throw err
    }
  })

  const get = primaryKey => table.get({
    Key: { [PRIMARY_KEY]: primaryKey }
  })

  return {
    get,
    createIfNotExists,
    save,
    del,
    merge,
    list
  }
}

function getKey (user) {
  return pick(user, PRIMARY_KEY)
}

function getProps (user) {
  return omit(user, PRIMARY_KEY)
}
