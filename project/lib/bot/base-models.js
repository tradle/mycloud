const mergeModels = require('@tradle/merge-models')
const base = require('@tradle/models').models
const custom = require('@tradle/custom-models')
const pingPong = {
  'tradle.Ping': {
    id: 'tradle.Ping',
    title: 'Ping',
    type: 'tradle.Model',
    properties: {}
  },
  'tradle.Pong': {
    id: 'tradle.Pong',
    title: 'Pong',
    type: 'tradle.Model',
    properties: {}
  }
}

module.exports = mergeModels()
  .add(base)
  .add(custom)
  .add(pingPong)
  .get()
