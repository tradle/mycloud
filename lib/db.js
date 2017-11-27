"use strict";
const dynamodb_1 = require("@tradle/dynamodb");
const messages_table_1 = require("./messages-table");
module.exports = function createDB(opts) {
    const { models, objects, tables, provider, aws, constants, env, dbUtils } = opts;
    const tableBuckets = dbUtils.getTableBuckets();
    let modelMap = dbUtils.getModelMap({ models });
    const chooseTable = ({ tables, type }) => {
        const tableName = modelMap.models[type];
        return tables.find(table => table.name === tableName);
    };
    const commonOpts = {
        models,
        objects,
        docClient: aws.docClient,
        maxItemSize: constants.MAX_DB_ITEM_SIZE,
        forbidScan: true,
        defaultReadOptions: {
            consistentRead: true
        }
    };
    const tableNames = tableBuckets.map(({ TableName }) => TableName);
    const db = new dynamodb_1.DB({
        models,
        tableNames,
        defineTable: name => {
            const cloudformation = tableBuckets[tableNames.indexOf(name)];
            return dynamodb_1.createTable(Object.assign({}, commonOpts, { tableDefinition: dynamodb_1.utils.toDynogelTableDefinition(cloudformation) }));
        },
        chooseTable
    });
    db.on('update:models', ({ models }) => {
        commonOpts.models = models;
        modelMap = dbUtils.getModelMap({ models });
    });
    const messageModel = models['tradle.Message'];
    if (!messageModel.isInterface) {
        const messagesTable = messages_table_1.createMessagesTable({
            models,
            getMyIdentity: () => provider.getMyPublicIdentity()
        });
        db.setExclusive({
            model: messageModel,
            table: messagesTable
        });
    }
    ;
    [
        {
            type: 'tradle.PubKey',
            definition: tables.PubKeys.definition,
        },
        {
            type: 'tradle.MyCloudFriend',
            definition: tables.Friends.definition,
        },
        {
            type: 'tradle.IotSession',
            definition: tables.Presence.definition,
            opts: {
                forbidScan: false
            }
        }
    ].forEach(({ type, definition, opts = {} }) => {
        const model = models[type];
        db.setExclusive({
            model,
            table: dynamodb_1.createTable(Object.assign({}, commonOpts, { exclusive: true, readOnly: !env.TESTING, model, tableDefinition: dynamodb_1.utils.toDynogelTableDefinition(definition) }, opts))
        });
    });
    return db;
};
//# sourceMappingURL=db.js.map