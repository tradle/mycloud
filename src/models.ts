import _ from 'lodash'

const core = require('@tradle/models').models
const models = _.extend(
  {},
  core,
  require('@tradle/custom-models'),
  require('@tradle/models-corporate-onboarding'),
  require('@tradle/models-products-bot'),
  require('@tradle/models-onfido'),
  require('@tradle/models-nz'),
  require('@tradle/models-cloud')
)

const baseMessageModel = models['tradle.Message']
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

const formModel = models['tradle.Form']
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

const appSubModel = {
  type: 'tradle.Model',
  id: 'tradle.ApplicationSubmission',
  title: 'Application Submission',
  properties: {
    // application: {
    //   type: 'object',
    //   ref: 'tradle.Application'
    // },
    // submission: {
    //   type: 'object',
    //   ref: 'tradle.Object'
    // },
    app: {
      type: 'string'
    },
    sub: {
      type: 'string'
    },
    subType: {
      type: 'string'
    },
    context: {
      type: 'string'
    }
  },
  required: [
    'app',
    'sub',
    'subType',
  ],
  primaryKeys: {
    hashKey: 'app',
    rangeKey: 'sub'
  },
  indexes: ['context']
}

core[appSubModel.id] = appSubModel

const appModel = models['tradle.Application']
appModel.properties.checks.items.backlink = 'application'
appModel.properties.submissions = {
  type: 'array',
  items: {
    ref: 'tradle.ApplicationSubmission',
    backlink: 'application'
  }
}

if (!appModel.indexes) {
  appModel.indexes = []
}

if (!appModel.indexes.find(i => i.hashKey === 'context')) {
  appModel.indexes.push({
    hashKey: 'context',
    rangeKey: '_time'
  })
}

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

// models[cloudEventModel.id] = cloudEventModel

export = models
