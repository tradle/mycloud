
import mergeModels = require('@tradle/merge-models')
import { models as base } from '@tradle/models'
import custom = require('@tradle/custom-models')

const mergeOpts = { validate: false }
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

export = mergeModels()
  .add(base, mergeOpts)
  .add(custom, mergeOpts)
  .add(cloud, mergeOpts)
  .get()
