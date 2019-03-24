import extend from 'lodash/extend'
import { Models } from './types'

const requireModels = moduleName => {
  const module = require(moduleName)
  return module.models || module
}

const core = requireModels('@tradle/models')

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
  primaryKeys: ['key'],
  indexes: []
}

core[jsonItem.id] = jsonItem

const models = extend(
  {},
  core,
  requireModels('@tradle/custom-models'),
  requireModels('@tradle/models-corporate-onboarding'),
  requireModels('@tradle/models-products-bot'),
  requireModels('@tradle/models-onfido'),
  requireModels('@tradle/models-nz'),
  requireModels('@tradle/models-cloud'),
  requireModels('@tradle/models-cloud-services')
)

export = models as Models
