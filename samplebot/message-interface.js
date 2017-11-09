const validateModelsVersion = require('@tradle/validate-model/package').version

module.exports = (function () {
  switch (validateModelsVersion[0]) {
    case '4':
      return null
    case '3':
      return 'tradle.ChatItem'
    default:
      return 'tradle.Message'
  }
})()
