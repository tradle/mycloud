const omit = require('object.omit')
const me = require('../test/fixtures/me')

module.exports = {
  lookupIdentity: () => Promise.resolve(omit(me, 'keys')),
  lookupIdentityKeys: () => Promise.resolve(me.keys),
}
