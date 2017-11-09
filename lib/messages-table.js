"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) if (e.indexOf(p[i]) < 0)
            t[p[i]] = s[p[i]];
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
const clone = require("clone");
const dynamodb_1 = require("@tradle/dynamodb");
const definitions = require('./definitions');
function createMessagesTable({ models }) {
    const model = models['tradle.Message'];
    const inbox = dynamodb_1.createTable({
        bodyInObjects: false,
        models,
        model,
        exclusive: true,
        forbidScan: true,
        readOnly: true,
        tableDefinition: dynamodb_1.utils.toDynogelTableDefinition(definitions.InboxTable.Properties)
    });
    const outbox = dynamodb_1.createTable({
        bodyInObjects: false,
        models,
        model,
        exclusive: true,
        forbidScan: true,
        readOnly: true,
        tableDefinition: dynamodb_1.utils.toDynogelTableDefinition(definitions.OutboxTable.Properties)
    });
    const getBoxFromFilter = query => {
        const { filter = {} } = query;
        const { EQ = {} } = filter;
        if (typeof EQ._inbound !== 'boolean') {
            throw new Error('expected "_inbound" property in "EQ"');
        }
        return EQ._inbound ? inbox : outbox;
    };
    const sanitizeQuery = (query) => {
        query = clone(query);
        delete query.filter.EQ._inbound;
        return query;
    };
    const execQuery = (method, query) => __awaiter(this, void 0, void 0, function* () {
        const box = getBoxFromFilter(query);
        return box[method](sanitizeQuery(query));
    });
    const find = query => execQuery('find', query);
    const findOne = query => execQuery('findOne', query);
    const get = (_a) => __awaiter(this, void 0, void 0, function* () {
        var { _inbound } = _a, query = __rest(_a, ["_inbound"]);
        const box = _inbound ? inbox : outbox;
        return box.get(query);
    });
    const table = {
        exclusive: true,
        get,
        search: find,
        find,
        findOne,
        model,
        name: 'messageTablePlaceholderName'
    };
    ['put', 'del', 'update', 'batchPut', 'latest'].forEach(method => {
        table[method] = () => __awaiter(this, void 0, void 0, function* () {
            throw new Error(`"${method}" is not supported on tradle.Message table`);
        });
    });
    return table;
}
exports.createMessagesTable = createMessagesTable;
//# sourceMappingURL=messages-table.js.map