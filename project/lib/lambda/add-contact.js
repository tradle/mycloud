const debug = require('debug')('λ:addcontact')
const { wrap, identities } = require('../')

exports.handler = wrap(function (event, context) {
  const { link } = event
  debug('adding contact', link)
  return identities.addContact({ link })
})
