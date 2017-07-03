module.exports = {
  'tradle.aws.CurrentAccount': {
    type: 'tradle.Model',
    title: 'Current Account',
    id: 'tradle.aws.CurrentAccount',
    interfaces: ['tradle.Message'],
    subClassOf: 'tradle.FinancialProduct',
    forms: [
      'tradle.PhotoID',
      'tradle.Selfie'
    ],
    properties: {}
  }
}
