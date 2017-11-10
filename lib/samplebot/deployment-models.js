const messageInterface = require('./message-interface');
const interfaces = messageInterface ? [messageInterface] : [];
module.exports = namespace => {
    const DEPLOYMENT = `${namespace}.Deployment`;
    const CONFIGURATION = `${namespace}.Configuration`;
    const PRODUCT_DEF = `${namespace}.ProductDefinition`;
    return {
        [DEPLOYMENT]: {
            type: 'tradle.Model',
            title: 'MyCloud',
            id: DEPLOYMENT,
            interfaces,
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
        [CONFIGURATION]: {
            type: 'tradle.Model',
            title: 'MyCloud Configuration',
            id: CONFIGURATION,
            interfaces,
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
        },
        [PRODUCT_DEF]: {
            type: 'tradle.Model',
            title: 'Product Definition',
            id: PRODUCT_DEF,
            interfaces,
            subClassOf: 'tradle.Form',
            properties: {
                name: {
                    type: 'string',
                    description: 'the name of your product'
                },
            }
        }
    };
};
//# sourceMappingURL=deployment-models.js.map