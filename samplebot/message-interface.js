const validateModelsVersion = require('@tradle/validate-model/package').version
module.exports = validateModelsVersion[0] === '3' ? 'tradle.ChatItem' : 'tradle.Message'
