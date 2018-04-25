import _ from 'lodash'
import { Models } from './types'

const core = require('@tradle/models').models

const baseMessageModel = core['tradle.Message']
if (!baseMessageModel.properties._counterparty) {
  baseMessageModel.properties._counterparty = {
    type: 'string',
    virtual: true
  }
}

// baseMessageModel.properties._dcounterpartyh = {
//   type: 'string',
//   virtual: true
// }

if (!baseMessageModel.properties._dcounterparty) {
  baseMessageModel.properties._dcounterparty = {
    type: 'string',
    virtual: true
  }
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

if (!baseMessageModel.primaryKeys) {
  baseMessageModel.primaryKeys = {
    hashKey: '_counterparty',
    rangeKey: 'time'
  }
}

if (!baseMessageModel.indexes) {
  baseMessageModel.indexes = [
    {
      hashKey: '_dcounterparty',
      rangeKey: 'time'
    },
    {
      hashKey: 'context',
      rangeKey: 'time'
    },
    {
      hashKey: '_payloadType',
      rangeKey: 'time'
    },
    {
      hashKey: '_link'
    }
  ]
}

// const formModel = core['tradle.Form']
// if (!formModel.properties.verifications) {
//   formModel.properties.verifications = {
//     type: 'array',
//     readOnly: true,
//     items: {
//       backlink: 'document',
//       ref: 'tradle.Verification'
//     }
//   }
// }

// const appSubModel = {
//   type: 'tradle.Model',
//   id: 'tradle.ApplicationSubmission',
//   title: 'Application Submission',
//   properties: {
//     application: {
//       type: 'object',
//       ref: 'tradle.Application'
//     },
//     submission: {
//       type: 'object',
//       ref: 'tradle.Object'
//     },
//     // a: {
//     //   type: 'string'
//     // },
//     // b: {
//     //   type: 'string'
//     // },
//     context: {
//       type: 'string'
//     }
//   },
//   required: [
//     'application',
//     'submission',
//     // 'bType',
//   ],
//   primaryKeys: {
//     hashKey: 'application.permalink',
//     rangeKey: 'submission.permalink'
//   },
//   indexes: [
//     {
//       hashKey: 'context',
//       rangeKey: '_time'
//     }
//   ]
// }

// core[appSubModel.id] = appSubModel

const appModel = core['tradle.Application']
// appModel.properties.checks.items.backlink = 'application'
// appModel.properties.submissions = {
//   type: 'array',
//   items: {
//     ref: 'tradle.ApplicationSubmission',
//     backlink: 'application'
//   }
// }

// appModel.properties.emailChecks = {
//   type: 'array',
//   items: {
//     ref: 'tradle.EmailCheck',
//     backlink: 'application'
//   }
// }

if (!appModel.indexes) {
  appModel.indexes = []
}

if (!appModel.indexes.find(i => i.hashKey === 'context')) {
  appModel.indexes.push({
    hashKey: 'context',
    rangeKey: '_time'
  })
}

const jsonItem = {
  type: 'tradle.Model',
  id: 'tradle.POJO',
  title: 'JSON item',
  properties: {
    key: {
      type: 'string'
    }
    // additional properties are not covered by schema
  },
  required: ['key'],
  primaryKeys: ['key']
}

core[jsonItem.id] = jsonItem

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

export = models as Models
