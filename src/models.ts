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

// const deferredAction = {
//   id: 'tradle.DeferredAction',
//   properties: {

//     arg: {
//       type: 'object',
//       range: 'json'
//     }
//   }
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

const emailCheckModel = {
  type: 'tradle.Model',
  id: 'tradle.EmailCheck',
  title: 'Email Check',
  subClassOf: 'tradle.Check',
  description: 'check for who controls an email address',
  properties: {
    provider: {
      type: 'string',
      readOnly: true
    },
    status: {
      type: 'object',
      ref: 'tradle.Status',
      readOnly: true
    },
    emailAddress: {
      type: 'string',
      range: 'email',
      readOnly: true
    },
    application: {
      type: 'object',
      ref: 'tradle.Application'
    }
  },
  required: [
    'provider',
    'emailAddress'
  ]
}

base[emailCheckModel.id] = emailCheckModel

export = base
