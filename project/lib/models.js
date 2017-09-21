
const mergeModels = require('@tradle/merge-models')
const base = require('@tradle/models').models
const custom = require('@tradle/custom-models')
const cloud = {
  'tradle.MyCloudFriend': {
    type: 'tradle.Model',
    id: 'tradle.MyCloudFriend',
    title: 'MyCloud Friend',
    properties: {
      name: {
        type: 'string',
      },
      url: {
        type: 'string',
      },
      bot: {
        type: 'object',
        ref: 'tradle.Identity'
      },
      org: {
        type: 'object',
        ref: 'tradle.Organization'
      },
      publicConfig: {
        type: 'object',
        range: 'json'
      }
    },
    required: [
      'name',
      'url'
    ]
  }
}

module.exports = mergeModels()
  .add(base)
  .add(custom)
  .add(cloud)
  .get()
