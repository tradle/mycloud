"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require('./env').install();
const { co } = require('../utils');
const { isResourceEnvironmentVariable } = require('../service-map');
const tradle = require('../').createTestTradle();
const { dbUtils: { getTable, marshalDBItem } } = tradle;
const Errors = require('../errors');
const yml = require('../cli/serverless-yml');
const Logger = require('../logger').default;
const createSilentLogger = (opts = {}) => {
    const logger = new Logger(opts);
    logger.setWriter({
        log: () => { }
    });
    return logger;
};
exports.createSilentLogger = createSilentLogger;
function getSchema(logicalName) {
    const { resources: { Resources } } = require('../cli/serverless-yml');
    const { Type, Properties } = Resources[logicalName];
    if (Type === 'AWS::DynamoDB::Table' && Properties.StreamSpecification) {
        Properties.StreamSpecification.StreamEnabled = true;
    }
    return Properties;
}
exports.getSchema = getSchema;
const recreateTable = co(function* (schema) {
    if (typeof schema === 'string') {
        schema = getSchema(schema);
    }
    const table = getTable(schema.TableName);
    try {
        yield table.destroy();
    }
    catch (err) { }
    yield table.create(schema);
    return table;
});
exports.recreateTable = recreateTable;
function toStreamItems(changes) {
    return {
        Records: [].concat(changes).map(change => {
            return {
                dynamodb: {
                    NewImage: marshalDBItem(change.new),
                    OldImage: change.old && marshalDBItem(change.old)
                }
            };
        })
    };
}
exports.toStreamItems = toStreamItems;
function getter(map) {
    return co(function* (key) {
        if (key in map) {
            return map[key];
        }
        throw new Errors.NotFound(key);
    });
}
exports.getter = getter;
function putter(map) {
    return co(function* (key, value) {
        map[key] = value;
    });
}
exports.putter = putter;
function deleter(map) {
    return co(function* (key) {
        const val = map[key];
        delete map[key];
        return val;
    });
}
exports.deleter = deleter;
function scanner(map) {
    return co(function* () {
        return Object.keys(map).map(key => map[key]);
    });
}
exports.scanner = scanner;
function reprefixServices(map, prefix) {
    const { service } = yml;
    const { stage } = yml.custom;
    const reprefixed = {};
    for (let key in map) {
        let val = map[key];
        if (isResourceEnvironmentVariable(key)) {
            reprefixed[key] = val.replace(`${service}-${stage}-`, prefix);
        }
        else {
            reprefixed[key] = val;
        }
    }
    return reprefixed;
}
exports.reprefixServices = reprefixServices;
//# sourceMappingURL=utils.js.map