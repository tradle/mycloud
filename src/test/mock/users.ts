import clone from 'clone'
import { getter, putter, deleter, scanner } from '../utils'

const promiseNoop = async () => {}

export = function fakeUsers (opts:any={}) {
  const {
    users={},
    oncreate=promiseNoop
  } = opts

  return {
    get: getter(users),
    merge: async (user) => {
      const { id } = user
      if (!users[id]) {
        users[id] = user
        return user
      }

      users[id] = clone(users[id], user)
      return users[id]
    },
    save: putter(users),
    list: scanner(users),
    createIfNotExists: async (user) => {
      if (!users[user.id]) {
        users[user.id] = user
        await oncreate(user)
      }

      return users[user.id]
    },
    del: deleter(users)
  }
}
