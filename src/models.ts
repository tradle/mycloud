
const mergeModels = require('@tradle/merge-models')
const mergeOpts = { validate: false }
const base = require('@tradle/models').models
const baseMessageModel = base['tradle.Message']
baseMessageModel.properties._counterparty = {
  type: 'string',
  virtual: true
}

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
  'tradle.MyCloudFriend': require('./tradle.MyCloudFriend.json'),
  'tradle.GraphQLQuery': require('./tradle.GraphQLQuery.json'),
  'tradle.IotSession': require('./tradle.IotSession.json'),
  'tradle.OnfidoVerification': require('./tradle.OnfidoVerification.json')
}

module.exports = mergeModels()
  .add(base, mergeOpts)
  .add(custom, mergeOpts)
  .add(cloud, mergeOpts)
  .get()
