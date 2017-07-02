
module.exports = {
  'tradle.aws.Deployment': {
    type: 'tradle.Model',
    title: 'Tradle in AWS',
    id: 'tradle.aws.Deployment',
    interfaces: ['tradle.Message'],
    subClassOf: 'tradle.FinancialProduct',
    forms: [
      'tradle.aws.Configuration'
    ],
    properties: {
      scale: {
        type: 'number'
      }
    }
  },
  'tradle.aws.Configuration': {
    type: 'tradle.Model',
    title: 'AWS Configuration',
    id: 'tradle.aws.Configuration',
    interfaces: ['tradle.Message'],
    subClassOf: 'tradle.Form',
    properties: {
      name: {
        type: 'string',
        description: 'the name of your organization'
      },
      scale: {
        type: 'number',
        description: 'in millions of customers, e.g. 100 means 100M customers'
      },
      domain: {
        type: 'string',
        description: 'top level domain you own'
      },
      // subdomain: {
      //   type: 'string',
      //   pattern: /[a-zA-Z]/,
      //   description: 'subdomain at which to place the Tradle cloud public endpoints'
      // }
    }
  },
  'tradle.aws.ProductDefinition': {
    type: 'tradle.Model',
    title: 'Product Definition',
    id: 'tradle.aws.ProductDefinition',
    interfaces: ['tradle.Message'],
    subClassOf: 'tradle.Form',
    properties: {
      name: {
        type: 'string',
        description: 'the name of your product'
      },
      // forms: {
      //   type: 'array',
      //   ref: 'tradle.Form',
      //   description: 'the forms required in your product'
      // }
    }
  },
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
