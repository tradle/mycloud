
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
      identity: {
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
      _identityPermalink: {
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
  },
  'tradle.PubKey': {
    type: 'tradle.Model',
    id: 'tradle.PubKey',
    title: 'Public Key',
    properties: {
      networkName: {
        readOnly: true,
        type: 'string'
      },
      purpose: {
        readOnly: true,
        type: 'string'
      },
      type: {
        readOnly: true,
        type: 'string',
      },
      fingerprint: {
        readOnly: true,
        type: 'string'
      },
      pub: {
        readOnly: true,
        type: 'string'
      },
      link: {
        type: 'string',
        description: 'link to latest identity version',
        virtual: true
      },
      permalink: {
        type: 'string',
        description: 'link to original identity',
        virtual: true
      }
    },
    primaryKeys: {
      hashKey: 'pub'
    }
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

;(function () {
  if (base['tradle.Message'].isInterface) return

  for (let id in defaultSet) {
    fix(defaultSet[id])
  }

  function fix (model) {
    model.interfaces = (model.interfaces || []).map(iface => {
      return iface === 'tradle.Message' ? 'tradle.ChatItem' : iface
    })

    return model
  }
}())

module.exports = mergeModels()
  .add(defaultSet)
  .add(cloud)
  .get()
