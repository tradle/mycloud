const co = require('co').wrap
const clone = require('clone')
const { getter, putter, deleter, scanner } = require('../utils')
const promiseNoop = co(function* () {})

module.exports = function fakeUsers (opts={}) {
  const {
    users={},
    oncreate=promiseNoop
  } = opts

  return {
    get: getter(users),
    merge: co(function* (user) {
      const { id } = user
      if (!users[id]) {
        users[id] = user
        return user
      }

      users[id] = clone(users[id], user)
      return users[id]
    }),
    save: putter(users),
    list: scanner(users),
    createIfNotExists: co(function* (user) {
      if (!users[user.id]) {
        users[user.id] = user
        yield oncreate(user)
      }

      return users[user.id]
    }),
    del: deleter(users)
  }
}
