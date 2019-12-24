import extend from 'lodash/extend'
import { Models } from './types'
import { TYPES } from '@tradle/constants'
const { FORM } = TYPES
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

let models: any = extend(
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
let formBacklinks = []
let formProps = models[FORM].properties
for (let p in formProps) {
  let prop = formProps[p]
  if (prop.items && prop.items.backlink) formBacklinks.push({ [p]: prop })
}

for (let m in models) {
  let model = models[m]
  if (model.abstract || !model.subClassOf) continue
  let sub = model
  while (sub.subClassOf && sub.subClassOf !== FORM) sub = models[sub.subClassOf]
  if (!sub.subClassOf) continue
  formBacklinks.forEach(bl => {
    let p = Object.keys(bl)[0]
    if (!model.properties[p]) extend(model.properties, { [p]: bl[p] })
  })
}
export = models as Models
