"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require('./env').install();
const utils_1 = require("../utils");
const _1 = require("../");
const Errors = require("../errors");
const logger_1 = require("../logger");
const tradle = _1.createTestTradle();
const { dbUtils: { getTable, marshalDBItem } } = tradle;
const createSilentLogger = () => {
    const logger = new logger_1.default('silent');
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
const recreateTable = utils_1.co(function* (schema) {
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
    return utils_1.co(function* (key) {
        if (key in map) {
            return map[key];
        }
        throw new Errors.NotFound(key);
    });
}
exports.getter = getter;
function putter(map) {
    return utils_1.co(function* (key, value) {
        map[key] = value;
    });
}
exports.putter = putter;
function deleter(map) {
    return utils_1.co(function* (key) {
        const val = map[key];
        delete map[key];
        return val;
    });
}
exports.deleter = deleter;
function scanner(map) {
    return utils_1.co(function* () {
        return Object.keys(map).map(key => map[key]);
    });
}
exports.scanner = scanner;
//# sourceMappingURL=utils.js.map