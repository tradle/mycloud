const debug = require('debug')('λ:addcontact')
const wrap = require('../wrap')
const { addContact } = require('../identities')

exports.handler = wrap(function (event, context) {
  const { link } = event
  debug('adding contact', link)
  return addContact({ link })
})
