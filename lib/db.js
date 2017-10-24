"use strict";
const dynamodb_1 = require("@tradle/dynamodb");
const messages_table_1 = require("./messages-table");
const definitions = require('./definitions');
module.exports = function createDB(opts) {
    const { models, objects, tables, aws, constants, env, dbUtils } = opts;
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
        defaultReadOptions: {
            consistentRead: true
        }
    };
    const db = new dynamodb_1.DB({
        tableNames: modelMap.tableNames,
        tableOpts: Object.assign({}, commonOpts, { tableDefinition: dynamodb_1.utils.toDynogelTableDefinition(tableBuckets[0]) }),
        chooseTable
    });
    db.on('update:models', ({ models }) => {
        modelMap = dbUtils.getModelMap({ models });
    });
    const messageModel = models['tradle.Message'];
    if (!messageModel.isInterface) {
        const messagesTable = messages_table_1.createMessagesTable({ models, tables });
        db.setExclusive({
            model: messageModel,
            table: messagesTable
        });
    }
    const pubKeyModel = models['tradle.PubKey'];
    const pubKeysDef = definitions.PubKeysTable.Properties;
    db.setExclusive({
        model: models['tradle.PubKey'],
        table: dynamodb_1.createTable(pubKeysDef.TableName, Object.assign({}, commonOpts, { readOnly: true, model: models['tradle.PubKey'], tableDefinition: dynamodb_1.utils.toDynogelTableDefinition(pubKeysDef) }))
    });
    return db;
};
//# sourceMappingURL=db.js.map