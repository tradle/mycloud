import { getter } from '../utils'

export = function fakeSeals (opts={}) {
  const { seals={} } = opts
  return {
    create: async ({ link }) => {
      seals[link] = { link }
    },
    get: getter(seals)
  }
}
