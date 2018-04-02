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

// const backlinkModel = {
//   "type": "tradle.Model",
//   "id": "tradle.ResourceLink",
//   "title": "Resource Link",
//   "properties": {
//     "sourceType": {
//       "type": "string"
//     },
//     "source": {
//       "type": "string",
//       "description": "{type}_{permalink}"
//     },
//     "sourceLink": {
//       "type": "string"
//     },
//     "target": {
//       "type": "string",
//       "description": "{type}_{permalink}"
//     },
//     "targetLink": {
//       "type": "string"
//     }
//   },
//   "required": [
//     "sourceType",
//     "source",
//     "sourceLink",
//     "target",
//     "targetLink"
//   ],
//   "primaryKeys": {
//     "hashKey": "target",      // e.g. 'tradle.PhotoID_abc'
//     "rangeKey": "sourceType"  // e.g. 'tradle.Verification'
//   }
// }

// base[backlinkModel.id] = backlinkModel

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

const sealState = {
  type: 'tradle.Model',
  id: 'tradle.SealState',
  title: 'Seal State',
  properties: {
    sealId: {
      type: 'string'
    },
    link: {
      type: 'string'
    },
    permalink: {
      type: 'string'
    },
    forResource: {
      type: 'object',
      ref: 'tradle.Object'
    },
    counterparty: {
      type: 'string'
    },
    blockchain: {
      type: 'string'
    },
    network: {
      type: 'string'
    },
    address: {
      type: 'string'
    },
    pubKey: {
      type: 'object',
      range: 'json'
    },
    watchType: {
      type: 'string',
      // oneOf: ['this', 'next']
    },
    confirmations: {
      type: 'number'
    },
    write: {
      type: 'boolean'
    },
    errors: {
      type: 'object',
      range: 'json'
    },
    unconfirmed: {
      type: 'boolean'
    },
    unsealed: {
      type: 'boolean'
    },
    txId: {
      type: 'string'
    },
    // nanoseconds
    dateSealed: {
      type: 'number'
    },
    dateWriteCanceled: {
      type: 'date'
    }
  },
  primaryKeys: ['link'],
  indexes: [
    {
      hashKey: 'unsealed',
      rangeKey: '_time'
    },
    {
      hashKey: 'unconfirmed',
      rangeKey: '_time'
    }
  ],
  required: [
    'link'
  ]
}

base[sealState.id] = sealState

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
