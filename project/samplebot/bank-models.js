module.exports = namespace => {
  `${namespace}.CurrentAccount`: {
    type: 'tradle.Model',
    title: 'Current Account',
    id: `${namespace}.CurrentAccount`,
    interfaces: ['tradle.Message'],
    subClassOf: 'tradle.FinancialProduct',
    forms: [
      'tradle.PhotoID',
      'tradle.Selfie'
    ],
    properties: {}
  }
}
