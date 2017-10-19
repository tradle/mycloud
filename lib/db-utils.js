"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const debug = require('debug')('tradle:sls:db-utils');
const dynamodb_marshaler_1 = require("dynamodb-marshaler");
exports.marshalDBItem = dynamodb_marshaler_1.marshalItem;
exports.unmarshalDBItem = dynamodb_marshaler_1.unmarshalItem;
const { NotFound } = require('./errors');
const { co, pick, logify, timestamp, wait, clone, batchify } = require('./utils');
const string_utils_1 = require("./string-utils");
const Errors = require("./errors");
const MAX_BATCH_SIZE = 25;
const CONSISTENT_READ_EVERYTHING = true;
exports.default = createDBUtils;
function createDBUtils({ aws, env }) {
    const debug = env.logger('db-utils');
    function getTable(TableName) {
        const batchPutToTable = co(function* (items) {
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
    const listTables = co(function* (env) {
        const { TableNames } = yield aws.dynamodb.listTables().promise();
        return TableNames.filter(name => name.startsWith(env.SERVERLESS_PREFIX));
    });
    const get = co(function* (params) {
        maybeForceConsistentRead(params);
        const result = yield exec('get', params);
        if (!result.Item) {
            throw new NotFound(JSON.stringify(pick(params, ['TableName', 'Key'])));
        }
        return result.Item;
    });
    const put = co(function* (params) {
        const result = yield exec('put', params);
        return tweakReturnValue(params, result);
    });
    const del = co(function* (params) {
        const result = yield exec('delete', params);
        return tweakReturnValue(params, result);
    });
    const find = co(function* (params) {
        maybeForceConsistentRead(params);
        const result = yield exec('query', params);
        if (result.LastEvaluatedKey) {
            debug('LastEvaluatedKey', result.LastEvaluatedKey);
        }
        return result.Items;
    });
    const findOne = co(function* (params) {
        params.Limit = 1;
        const results = yield find(params);
        if (!results.length) {
            throw new NotFound(`"${params.TableName}" query returned 0 items`);
        }
        return results[0];
    });
    const update = co(function* (params) {
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
    const scan = co(function* (params) {
        maybeForceConsistentRead(params);
        const { Items } = yield exec('scan', params);
        return Items;
    });
    const rawBatchPut = co(function* (params) {
        return yield exec('batchWrite', params);
    });
    const batchPut = co(function* (params, backoffOptions = {}) {
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
        getRecordsFromEvent
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