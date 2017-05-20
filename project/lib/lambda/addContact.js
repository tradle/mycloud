const debug = require('debug')('tradle:sls:λ:addcontact')
const wrap = require('../wrap')
const { addContact } = require('../identities')

exports.handler = wrap.promiser(function (event, context) {
  const { link } = event
  debug('adding contact', link)
  return addContact({ link })
})
