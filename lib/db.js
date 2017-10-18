"use strict";
const dynamodb_1 = require("@tradle/dynamodb");
const messages_table_1 = require("./messages-table");
module.exports = function createDB(opts) {
    const { models, objects, tables, aws, constants, env, prefix } = opts;
    const db = dynamodb_1.db({
        models,
        objects,
        docClient: aws.docClient,
        maxItemSize: constants.MAX_DB_ITEM_SIZE,
        prefix
    });
    const messageModel = models['tradle.Message'];
    if (!messageModel.isInterface) {
        const messagesTable = messages_table_1.createTable({ models, tables, prefix });
        db.setTableForType('tradle.Message', messagesTable);
    }
    const pubKeyModel = models['tradle.PubKey'];
    const pubKeys = dynamodb_1.createTable({
        models: Object.assign({}, models, { [pubKeyModel.id]: pubKeyModel }),
        objects,
        model: pubKeyModel,
        tableName: tables.PubKeys.name,
        prefix,
        hashKey: 'pub',
        indexes: []
    });
    db.setTableForType('tradle.PubKey', pubKeys);
    return db;
};
//# sourceMappingURL=db.js.map