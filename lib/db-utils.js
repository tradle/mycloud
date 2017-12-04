"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const debug = require('debug')('tradle:sls:db-utils');
const dynamodb_marshaler_1 = require("dynamodb-marshaler");
exports.marshalDBItem = dynamodb_marshaler_1.marshalItem;
exports.unmarshalDBItem = dynamodb_marshaler_1.unmarshalItem;
const dynogels = require("dynogels");
const validate_resource_1 = require("@tradle/validate-resource");
const logger_1 = require("./logger");
const errors_1 = require("./errors");
const utils_1 = require("./utils");
const string_utils_1 = require("./string-utils");
const crypto_1 = require("./crypto");
const Errors = require("./errors");
const definitions = require("./definitions");
const MAX_BATCH_SIZE = 25;
const CONSISTENT_READ_EVERYTHING = true;
const TABLE_BUCKET_REGEX = /-bucket-\d+$/;
exports.default = createDBUtils;
function createDBUtils({ aws, logger }) {
    const { debug } = logger;
    const dynogelsLogger = logger.sub('dynogels');
    if (logger.level >= logger_1.Level.WARN) {
        const level = logger.level >= logger_1.Level.SILLY ? 'info' : 'warn';
        dynogels.log = {
            info: (...data) => {
                const str = JSON.stringify(data);
                dynogelsLogger.info('', str.length > 1000 ? str.slice(0, 1000) + '...' : data);
            },
            warn: (...data) => dynogelsLogger.warn('', data),
            level
        };
    }
    let tableBuckets;
    const getTableBuckets = () => {
        if (!tableBuckets) {
            tableBuckets = Object.keys(definitions)
                .filter(logicalId => {
                return TABLE_BUCKET_REGEX.test(definitions[logicalId].Properties.TableName);
            })
                .map(logicalId => definitions[logicalId].Properties);
        }
        return tableBuckets;
    };
    function getTable(TableName) {
        const batchWriteToTable = (ops) => __awaiter(this, void 0, void 0, function* () {
            ops.forEach(({ type }) => {
                if (type !== 'put' && type !== 'del') {
                    throw new Error(`expected "type" to be either "put" or "del", got ${type}`);
                }
            });
            const batches = utils_1.batchify(ops, MAX_BATCH_SIZE);
            for (const batch of batches) {
                debug(`writing batch of ${batch.length} to ${TableName}`);
                yield batchPut({
                    RequestItems: {
                        [TableName]: batch.map(op => {
                            const reqType = op.type === 'put' ? 'PutRequest' : 'DeleteRequest';
                            return {
                                [reqType]: { Item: op.value }
                            };
                        })
                    }
                });
            }
        });
        const batchPutToTable = (items) => __awaiter(this, void 0, void 0, function* () {
            const ops = items.map(value => ({ type: 'put', value }));
            return batchWriteToTable(ops);
        });
        const batchDeleteFromTable = (items) => __awaiter(this, void 0, void 0, function* () {
            const ops = items.map(value => ({ type: 'del', value }));
            return batchWriteToTable(ops);
        });
        const tableAPI = {
            toString: () => TableName,
            batchWrite: batchWriteToTable,
            batchPut: batchPutToTable,
            batchDelete: batchDeleteFromTable
        };
        const api = {
            get,
            put,
            update,
            del,
            findOne,
            find,
            scan,
            create: createTable,
            createTable,
            destroy: deleteTable,
            deleteTable,
            query: find,
            queryOne: findOne,
            clear: () => clear(TableName)
        };
        Object.keys(api).forEach(method => {
            tableAPI[method] = (params = {}) => {
                params.TableName = TableName;
                return api[method](params);
            };
        });
        tableAPI.name = TableName;
        tableAPI.definition = getDefinition(TableName);
        return utils_1.timeMethods(tableAPI, logger);
    }
    const exec = (method, params) => __awaiter(this, void 0, void 0, function* () {
        params.ReturnConsumedCapacity = 'TOTAL';
        try {
            const result = yield aws.docClient[method](params).promise();
            logCapacityConsumption(method, result);
            return result;
        }
        catch (err) {
            Errors.rethrow(err, 'system');
            if (err.code === 'ValidationException') {
                throw new Errors.InvalidInput(err.message);
            }
            throw err;
        }
    });
    const dynamoDBExec = function dynamoDBExec(method, params) {
        return aws.dynamodb[method](params).promise();
    };
    const createTable = params => dynamoDBExec('createTable', params);
    const deleteTable = params => dynamoDBExec('deleteTable', params);
    const forEachItem = ({ tableName, fn }) => __awaiter(this, void 0, void 0, function* () {
        const TableName = tableName;
        const tableDescription = yield aws.dynamodb.describeTable({ TableName }).promise();
        let count = 0;
        let scan = yield exec('scan', { TableName });
        while (true) {
            let { Items, LastEvaluatedKey } = scan;
            if (!Items.length)
                break;
            const results = yield Promise.all(Items.map((item, i) => fn({
                tableDescription,
                i,
                item,
            })));
            if (results.includes(false))
                break;
            count += Items.length;
            if (!LastEvaluatedKey) {
                break;
            }
            scan = yield exec('scan', {
                TableName,
                ExclusiveStartKey: LastEvaluatedKey
            });
        }
        return count;
    });
    const clear = (TableName) => __awaiter(this, void 0, void 0, function* () {
        return yield forEachItem({
            tableName: TableName,
            fn: ({ item, tableDescription }) => __awaiter(this, void 0, void 0, function* () {
                const { KeySchema } = tableDescription.Table;
                const keyProps = KeySchema.map(({ AttributeName }) => AttributeName);
                yield exec('delete', {
                    TableName,
                    Key: utils_1.pick(item, keyProps)
                });
            })
        });
    });
    const listTables = (env) => __awaiter(this, void 0, void 0, function* () {
        let tables = [];
        let opts = {};
        while (true) {
            let { TableNames, LastEvaluatedTableName } = yield aws.dynamodb.listTables(opts).promise();
            tables = tables.concat(TableNames);
            if (!TableNames.length || !LastEvaluatedTableName) {
                break;
            }
            opts.ExclusiveStartTableName = LastEvaluatedTableName;
        }
        return tables.filter(name => name.startsWith(env.SERVERLESS_PREFIX));
    });
    const get = (params) => __awaiter(this, void 0, void 0, function* () {
        maybeForceConsistentRead(params);
        const result = yield exec('get', params);
        if (!result.Item) {
            throw new errors_1.NotFound(JSON.stringify(utils_1.pick(params, ['TableName', 'Key'])));
        }
        return result.Item;
    });
    const put = (params) => __awaiter(this, void 0, void 0, function* () {
        const result = yield exec('put', params);
        return tweakReturnValue(params, result);
    });
    const del = (params) => __awaiter(this, void 0, void 0, function* () {
        const result = yield exec('delete', params);
        return tweakReturnValue(params, result);
    });
    const find = (params) => __awaiter(this, void 0, void 0, function* () {
        maybeForceConsistentRead(params);
        const result = yield exec('query', params);
        return result.Items;
    });
    const findOne = (params) => __awaiter(this, void 0, void 0, function* () {
        params.Limit = 1;
        const results = yield find(params);
        if (!results.length) {
            throw new errors_1.NotFound(`"${params.TableName}" query returned 0 items`);
        }
        return results[0];
    });
    const update = (params) => __awaiter(this, void 0, void 0, function* () {
        const result = yield exec('update', params);
        return tweakReturnValue(params, result);
    });
    function maybeForceConsistentRead(params) {
        if (CONSISTENT_READ_EVERYTHING && !params.IndexName && !params.ConsistentRead) {
            params.ConsistentRead = true;
            logger.info('forcing consistent read');
        }
    }
    function tweakReturnValue(params, result) {
        if (params.ReturnValues !== 'NONE') {
            return result.Attributes;
        }
        return result;
    }
    const scan = (params) => __awaiter(this, void 0, void 0, function* () {
        maybeForceConsistentRead(params);
        const { Items } = yield exec('scan', params);
        return Items;
    });
    const rawBatchPut = (params) => __awaiter(this, void 0, void 0, function* () {
        return yield exec('batchWrite', params);
    });
    const batchPut = (params, backoffOptions = {}) => __awaiter(this, void 0, void 0, function* () {
        params = utils_1.clone(params);
        const { backoff = defaultBackoffFunction, maxTries = 6 } = backoffOptions;
        let tries = 0;
        let failed;
        while (tries < maxTries) {
            let result = yield rawBatchPut(params);
            failed = result.UnprocessedItems;
            if (!(failed && Object.keys(failed).length > 0))
                return;
            params.RequestItems = failed;
            yield utils_1.wait(backoff(tries++));
        }
        const err = new Errors.BatchPutFailed();
        err.failed = failed;
        err.attempts = tries;
        throw err;
    });
    function getModelMap({ types, models, tableNames }) {
        if (!tableNames) {
            tableNames = getTableBuckets().map(def => def.TableName);
        }
        tableNames.sort(string_utils_1.alphabetical);
        const modelToBucket = {};
        if (!types) {
            types = Object.keys(models)
                .filter(id => validate_resource_1.utils.isInstantiable(models[id]));
        }
        types.forEach(id => {
            const num = parseInt(crypto_1.sha256(id, 'hex').slice(0, 6), 16);
            const idx = num % tableNames.length;
            modelToBucket[id] = tableNames[idx];
        });
        return {
            tableNames,
            models: modelToBucket
        };
    }
    return utils_1.timeMethods({
        forEachItem,
        listTables,
        createTable,
        deleteTable,
        clear,
        get,
        put,
        update,
        del,
        find,
        findOne,
        batchPut,
        getUpdateParams,
        marshalDBItem: dynamodb_marshaler_1.marshalItem,
        unmarshalDBItem: dynamodb_marshaler_1.unmarshalItem,
        getTable,
        getRecordsFromEvent,
        getTableBuckets,
        getModelMap
    }, logger);
}
function jitter(val, percent) {
    return val * (1 + 2 * percent * Math.random() - percent);
}
function defaultBackoffFunction(retryCount) {
    const delay = Math.pow(2, retryCount) * 500;
    return Math.min(jitter(delay, 0.1), 10000);
}
function getRecordsFromEvent(event, oldAndNew) {
    return event.Records.map(record => {
        const { NewImage, OldImage } = record.dynamodb;
        if (oldAndNew) {
            return {
                old: OldImage && dynamodb_marshaler_1.unmarshalItem(OldImage),
                new: NewImage && dynamodb_marshaler_1.unmarshalItem(NewImage)
            };
        }
        return NewImage && dynamodb_marshaler_1.unmarshalItem(NewImage);
    })
        .filter(data => data);
}
exports.getRecordsFromEvent = getRecordsFromEvent;
function logCapacityConsumption(method, result) {
    let type;
    switch (method) {
        case 'get':
        case 'query':
        case 'scan':
            type = 'RCU';
            break;
        default:
            type = 'WCU';
            break;
    }
    const { ConsumedCapacity } = result;
    if (ConsumedCapacity) {
        debug(`consumed ${string_utils_1.prettify(ConsumedCapacity)} ${type}s`);
    }
}
function getUpdateParams(item) {
    const keys = Object.keys(item);
    const toSet = keys.filter(key => item[key] != null);
    const toRemove = keys.filter(key => item[key] == null);
    let UpdateExpression = '';
    if (toSet.length) {
        const ops = toSet.map(key => `#${key} = :${key}`).join(', ');
        UpdateExpression += `SET ${ops} `;
    }
    if (toRemove.length) {
        const ops = toRemove.map(key => `#${key}`).join(', ');
        UpdateExpression += `REMOVE ${ops} `;
    }
    UpdateExpression = UpdateExpression.trim();
    if (!UpdateExpression.length) {
        throw new Error('nothing was updated!');
    }
    const ExpressionAttributeNames = {};
    const ExpressionAttributeValues = {};
    for (let key in item) {
        ExpressionAttributeNames[`#${key}`] = key;
        if (toSet.indexOf(key) !== -1) {
            ExpressionAttributeValues[`:${key}`] = item[key];
        }
    }
    return {
        ExpressionAttributeNames,
        ExpressionAttributeValues,
        UpdateExpression
    };
}
exports.getUpdateParams = getUpdateParams;
const getDefinition = tableName => {
    const logicalId = Object.keys(definitions).find(logicalId => {
        return definitions[logicalId].Properties.TableName === tableName;
    });
    return logicalId && definitions[logicalId].Properties;
};
//# sourceMappingURL=db-utils.js.map