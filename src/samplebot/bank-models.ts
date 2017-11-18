import clone = require('clone')

const corpModels = require('@tradle/models-corporate-onboarding')

export default function createBankModels (namespace) {
  const models = clone(corpModels)

  // get rid of this after upgrading models-corporate-onboarding
  for (let id in models) {
    let { interfaces=[] } = models[id]
    let idx = interfaces.indexOf('tradle.Message')
    if (idx !== -1) {
      interfaces.splice(idx, 1)
    }
  }

  return models
}
