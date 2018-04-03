import _ from 'lodash'

const base = _.extend(
  {},
  require('@tradle/models').models,
  require('@tradle/custom-models'),
  require('@tradle/models-corporate-onboarding'),
  require('@tradle/models-products-bot'),
  require('@tradle/models-onfido'),
  require('@tradle/models-nz'),
  require('@tradle/models-cloud')
)

const baseMessageModel = base['tradle.Message']
baseMessageModel.properties._counterparty = {
  type: 'string',
  virtual: true
}

// baseMessageModel.properties._dcounterpartyh = {
//   type: 'string',
//   virtual: true
// }

baseMessageModel.properties._dcounterparty = {
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

const formModel = base['tradle.Form']
if (!formModel.properties.verifications) {
  formModel.properties.verifications = {
    type: 'array',
    readOnly: true,
    items: {
      backlink: 'document',
      ref: 'tradle.Verification'
    }
  }
}

const appModel = base['tradle.Application']
appModel.properties.checks.items.backlink = 'application'

// const kvPair = {
//   type: 'tradle.Model',
//   id: 'tradle.KV',
//   title: 'Key Value Pair',
//   properties: {
//     key: {
//       type: 'string'
//     }
//     // additional properties are not covered by schema
//   },
//   required: ['key']
// }

// const cloudEventModel = {
//   type: 'tradle.Model',
//   id: 'tradle.cloud.Event',
//   title: 'Event',
//   properties: {
//     topic: {
//       type: 'string'
//     },
//     timeR: {
//       type: 'string'
//     },
//     dateN: {
//       type: 'string'
//     },
//     data: {
//       type: 'object',
//       range: 'json'
//     }
//   },
//   primaryKeys: {
//     hashKey: 'topic',
//     rangeKey: 'timeR',
//   },
//   required: [
//     'topic',
//     'timeR',
//     'dateN',
//     'data'
//   ]
// }

// base[cloudEventModel.id] = cloudEventModel

export = base
