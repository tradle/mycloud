const mergeModels = require('@tradle/merge-models')
const base = require('@tradle/models').models
const custom = require('@tradle/custom-models')

module.exports = mergeModels()
  .add(base)
  .add(custom)
  .get()
