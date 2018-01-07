
// import mergeModels = require('@tradle/merge-models')
const base = require('@tradle/models').models
const shared = require('@tradle/models-shared')
const cloud = require('@tradle/models-cloud')
// const onfidoVerificationModels = require('./onfido-verification-models.json')
// const mergeOpts = { validate: false }
const baseMessageModel = base['tradle.Message']
baseMessageModel.properties._counterparty = {
  type: 'string',
  virtual: true
}

if (!baseMessageModel.properties._inbound) {
  baseMessageModel.properties._inbound = {
    type: 'boolean',
    virtual: true
  }
}

if (!baseMessageModel.properties._deliveryStatus) {
  baseMessageModel.properties._deliveryStatus = {
    type: 'string',
    virtual: true
  }
}

// const cloud = {
//   ...deploymentModels,
//   ...onfidoVerificationModels,
//   // 'tradle.OutboxQuery': {
//   //   type: 'tradle.Model',
//   //   id: 'tradle.OutboxQuery',
//   //   title: 'Outbox Query',
//   //   properties: {
//   //     gt: {
//   //       type: 'date'
//   //     }
//   //   },
//   //   required: [
//   //     'gt'
//   //   ]
//   // },
//   'tradle.MyCloudFriend': require('./tradle.MyCloudFriend.json'),
//   'tradle.GraphQLQuery': require('./tradle.GraphQLQuery.json'),
//   'tradle.IotSession': require('./tradle.IotSession.json'),
// }

// export = mergeModels()
//   .add(base, mergeOpts)
//   .add(custom, mergeOpts)
//   .add(onfidoModels.all, mergeOpts)
//   .add(corporate, mergeOpts)
//   .add(nz, mergeOpts)
//   .add(cloud, mergeOpts)
//   .get()

export = {
  ...shared,
  ...cloud
}
