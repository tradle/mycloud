export default function createModelsForNamespace (namespace) {
  const DEPLOYMENT = `${namespace}.Deployment`
  const CONFIGURATION = `${namespace}.Configuration`
  const PRODUCT_DEF = `${namespace}.ProductDefinition`
  const deployment = {
    type: 'tradle.Model',
    title: 'MyCloud',
    id: DEPLOYMENT,
    subClassOf: 'tradle.FinancialProduct',
    forms: [
      CONFIGURATION
    ],
    properties: {
      scale: {
        type: 'number'
      }
    }
  }

  const configuration = {
    type: 'tradle.Model',
    title: 'MyCloud Configuration',
    id: CONFIGURATION,
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
        description: 'top level domain you own',
        pattern: '^[a-zA-Z0-9-_.]*$'
      },
      formattedScale: {
        type: 'string',
        displayAs: '~{1}M customers',
        title: 'MyCloud scale',
        group: [
          'scale'
        ],
        readOnly: true,
        displayName: true
      },

      // subdomain: {
      //   type: 'string',
      //   pattern: /[a-zA-Z]/,
      //   description: 'subdomain at which to place the Tradle cloud public endpoints'
      // }
      // route53: {
      //   type: 'boolean',
      //   description: "are you using Amazon's Route53 for your DNS. If yes, we can automate creation of the subdomain tradle.[yourdomain] and an SSL certificate"
      // }
    },
    viewCols: [
      'name',
      'formattedScale',
      'domain'
    ],
    editCols: [
      'name',
      'scale',
      'domain'
    ],
    required: [
      'name',
      'scale',
      'domain'
    ]
  }

  const productDefinition = {
    type: 'tradle.Model',
    title: 'Product Definition',
    id: PRODUCT_DEF,
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

  return {
    deployment,
    configuration,
    productDefinition,
    all: {
      [DEPLOYMENT]: deployment,
      [CONFIGURATION]: configuration,
      [PRODUCT_DEF]: productDefinition
    }
  }
}
