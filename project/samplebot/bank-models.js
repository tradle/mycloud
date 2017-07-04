module.exports = namespace => {
  const id = `${namespace}.CurrentAccount`
  return {
    [id]: {
      type: 'tradle.Model',
      title: 'Current Account',
      id,
      interfaces: ['tradle.Message'],
      subClassOf: 'tradle.FinancialProduct',
      forms: [
        'tradle.PhotoID',
        'tradle.Selfie'
      ],
      properties: {}
    }
  }
}
