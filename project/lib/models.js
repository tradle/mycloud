
const mergeModels = require('@tradle/merge-models')
const base = require('@tradle/models').models
const custom = require('@tradle/custom-models')
const cloud = {
  // 'tradle.OutboxQuery': {
  //   type: 'tradle.Model',
  //   id: 'tradle.OutboxQuery',
  //   title: 'Outbox Query',
  //   properties: {
  //     gt: {
  //       type: 'date'
  //     }
  //   },
  //   required: [
  //     'gt'
  //   ]
  // },
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
      },
      _botPermalink: {
        type: 'string',
        virtual: true
      }
    },
    required: [
      'name',
      'url'
    ],
    // primaryKeys: {
    //   hashKey: 'name'
    // }
  }
}

const defaultSet = mergeModels()
  .add(base)
  // .add({
  //     'tradle.Message': messageModel
  //   }, {
  //     overwrite: true
  //   })
  .add(custom)
  .get()

for (let id in defaultSet) {
  fix(defaultSet[id])
}

module.exports = mergeModels()
  .add(defaultSet)
  .add(cloud)
  .get()

function fix (model) {
  model.interfaces = (model.interfaces || []).map(iface => {
    return iface === 'tradle.Message' ? 'tradle.ChatItem' : iface
  })

  return model
}
