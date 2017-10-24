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
const validate_resource_1 = require("@tradle/validate-resource");
const { NotFound } = require('./errors');
const { co, pick, logify, timestamp, wait, clone, batchify } = require('./utils');
const string_utils_1 = require("./string-utils");
const crypto_1 = require("./crypto");
const Errors = require("./errors");
const MAX_BATCH_SIZE = 25;
const CONSISTENT_READ_EVERYTHING = true;
const definitions = require('./definitions');
const TABLE_BUCKET_REGEX = /-bucket-\d+$/;
exports.default = createDBUtils;
function createDBUtils({ aws, env }) {
    const debug = env.logger('db-utils');
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
        const batchPutToTable = (items) => __awaiter(this, void 0, void 0, function* () {
            const batches = batchify(items, MAX_BATCH_SIZE);
            for (const batch of batches) {
                debug(`putting batch of ${batch.length} to ${TableName}`);
                yield batchPut({
                    RequestItems: {
                        [TableName]: batch.map(Item => {
                            return {
                                PutRequest: { Item }
                            };
                        })
                    }
                });
            }
        });
        const tableAPI = {
            toString: () => TableName,
            batchPut: batchPutToTable
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
        return tableAPI;
    }
    const exec = co(function* (method, params) {
        params.ReturnConsumedCapacity = 'TOTAL';
        const result = aws.docClient[method](params).promise();
        logCapacityConsumption(method, result);
        return result;
    });
    const dynamoDBExec = function dynamoDBExec(method, params) {
        return aws.dynamodb[method](params).promise();
    };
    const createTable = params => dynamoDBExec('createTable', params);
    const deleteTable = params => dynamoDBExec('deleteTable', params);
    const clear = co(function* (TableName) {
        const tableInfo = yield aws.dynamodb.describeTable({ TableName }).promise();
        const { Table: { KeySchema } } = tableInfo;
        const keyProps = KeySchema.map(({ AttributeName }) => AttributeName);
        let count = 0;
        let scan = yield exec('scan', { TableName });
        while (true) {
            let { Items, LastEvaluatedKey } = scan;
            if (!Items.length)
                break;
            debug(`deleting ${Items.length} from table ${TableName}`);
            yield Items.map(item => exec('delete', {
                TableName,
                Key: pick(item, keyProps)
            }));
            count += Items.length;
            if (!LastEvaluatedKey) {
                break;
            }
            scan = yield exec('scan', { TableName, ExclusiveStartKey: LastEvaluatedKey });
        }
        return count;
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
            throw new NotFound(JSON.stringify(pick(params, ['TableName', 'Key'])));
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
        if (result.LastEvaluatedKey) {
            debug('LastEvaluatedKey', result.LastEvaluatedKey);
        }
        return result.Items;
    });
    const findOne = (params) => __awaiter(this, void 0, void 0, function* () {
        params.Limit = 1;
        const results = yield find(params);
        if (!results.length) {
            throw new NotFound(`"${params.TableName}" query returned 0 items`);
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
            debug('forcing consistent read');
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
        params = clone(params);
        const { backoff = defaultBackoffFunction, maxTries = 6 } = backoffOptions;
        let tries = 0;
        let failed;
        while (tries < maxTries) {
            let result = yield rawBatchPut(params);
            failed = result.UnprocessedItems;
            if (!(failed && Object.keys(failed).length > 0))
                return;
            params.RequestItems = failed;
            yield wait(backoff(tries++));
        }
        const err = new Errors.BatchPutFailed();
        err.failed = failed;
        err.attempts = tries;
        throw err;
    });
    function getModelMap({ models, tableNames }) {
        if (!tableNames) {
            tableNames = getTableBuckets().map(def => def.TableName);
        }
        tableNames.sort(string_utils_1.alphabetical);
        const modelToBucket = {};
        Object.keys(models)
            .filter(id => validate_resource_1.utils.isInstantiable(models[id]))
            .forEach(id => {
            const num = parseInt(crypto_1.sha256(id, 'hex').slice(0, 6), 16);
            const idx = num % tableNames.length;
            modelToBucket[id] = tableNames[idx];
        });
        return {
            tableNames,
            models: modelToBucket
        };
    }
    return {
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
    };
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
//# sourceMappingURL=db-utils.js.map