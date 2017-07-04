
module.exports = namespace => {
  `${namespace}.Deployment`: {
    type: 'tradle.Model',
    title: 'Tradle in AWS',
    id: `${namespace}.Deployment`,
    interfaces: ['tradle.Message'],
    subClassOf: 'tradle.FinancialProduct',
    forms: [
      `${namespace}.Configuration`
    ],
    properties: {
      scale: {
        type: 'number'
      }
    }
  },
  `${namespace}.Configuration`: {
    type: 'tradle.Model',
    title: 'AWS Configuration',
    id: `${namespace}.Configuration`,
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
  `${namespace}.ProductDefinition`: {
    type: 'tradle.Model',
    title: 'Product Definition',
    id: `${namespace}.ProductDefinition`,
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
  }
}
