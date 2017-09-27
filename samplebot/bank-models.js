// const { getReferences } = require('@tradle/validate-model').refs
// const clone = require('clone')
// const { getReferences } = require('@tradle/validate-model').refs
// const mergeModels = require('@tradle/merge-models')
// const baseModels = mergeModels()
//   .add(require('@tradle/models').models)
//   .add(require('@tradle/custom-models'))
//   .get()

const corpModels = require('@tradle/models-corporate-onboarding')
// const corpModels = require('./corp-models')
// const models = mergeModels()
//   .add(baseModels)
//   .add(corpModels)
//   .get()

module.exports = namespace => {
  return corpModels

  // const products = [
  //   'tradle.WealthManagementAccount',
  //   'cp.tradle.CorporateAccount'
  // ]

  // const byId = {}
  // products.forEach(ref => {
  //   const product = clone(models[ref])
  //   const name = product.id.split('.').pop()
  //   const namespaceParts = namespace.split('.').filter(part => part !== 'www')
  //   product.id = namespaceParts.concat(name).join('.')
  //   byId[product.id] = product
  // })

  // getReferences({
  //   models,
  //   subset: products
  // })
  // .filter(id => !baseModels[id])
  // .forEach(id => {
  //   byId[id] = models[id]
  //   if (!byId[id]) throw new Error('model not found: ' + id)
  // })

  // return byId
}

// console.log(module.exports('com.ubs'))

// module.exports = namespace => {
//   const id = `${namespace}.CurrentAccount`
//   return {
//     [id]: {
//       type: 'tradle.Model',
//       title: 'Current Account',
//       id,
//       interfaces: ['tradle.ChatItem'],
//       subClassOf: 'tradle.FinancialProduct',
//       forms: [
//         'tradle.PhotoID',
//         'tradle.Selfie'
//       ],
//       properties: {}
//     }
//   }
// }
