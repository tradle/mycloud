"use strict";
const dynogels = require("dynogels");
const dynamodb_1 = require("@tradle/dynamodb");
const messages_table_1 = require("./messages-table");
module.exports = function createDB(tradle) {
    const { modelStore, objects, tables, aws, constants, env, dbUtils } = tradle;
    dynogels.dynamoDriver(aws.dynamodb);
    const tableBuckets = dbUtils.getTableBuckets();
    const commonOpts = {
        get models() {
            return modelStore.models;
        },
        objects,
        docClient: aws.docClient,
        maxItemSize: constants.MAX_DB_ITEM_SIZE,
        forbidScan: true,
        defaultReadOptions: {
            ConsistentRead: true
        }
    };
    let modelMap;
    const updateModelMap = () => {
        modelMap = dbUtils.getModelMap({ models: modelStore.models });
    };
    modelStore.on('update', updateModelMap);
    updateModelMap();
    const chooseTable = ({ tables, type }) => {
        const tableName = modelMap.models[type];
        return tables.find(table => table.name === tableName);
    };
    const tableNames = tableBuckets.map(({ TableName }) => TableName);
    const db = new dynamodb_1.DB({
        modelStore,
        tableNames,
        defineTable: name => {
            const cloudformation = tableBuckets[tableNames.indexOf(name)];
            return dynamodb_1.createTable(Object.assign({}, commonOpts, { tableDefinition: dynamodb_1.utils.toDynogelTableDefinition(cloudformation) }));
        },
        chooseTable
    });
    const messageModel = modelStore.models['tradle.Message'];
    if (!messageModel.isInterface) {
        const messagesTable = messages_table_1.createMessagesTable({
            models: modelStore.models,
            getMyIdentity: () => tradle.provider.getMyPublicIdentity()
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
        const model = modelStore.models[type];
        db.setExclusive({
            model,
            table: dynamodb_1.createTable(Object.assign({}, commonOpts, { exclusive: true, model, tableDefinition: dynamodb_1.utils.toDynogelTableDefinition(definition) }, opts))
        });
    });
    return db;
};
//# sourceMappingURL=db.js.map