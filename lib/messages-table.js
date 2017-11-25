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
const omit = require("object.omit");
const dynamodb_1 = require("@tradle/dynamodb");
const { getQueryInfo } = dynamodb_1.utils;
const definitions = require('./definitions');
function createMessagesTable({ models, getMyIdentity }) {
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
        if (typeof EQ._inbound === 'boolean') {
            return EQ._inbound ? inbox : outbox;
        }
    };
    const sanitizeQuery = (query) => {
        query = clone(query);
        delete query.filter.EQ._inbound;
        return query;
    };
    const execQuery = (method, query) => __awaiter(this, void 0, void 0, function* () {
        const box = getBoxFromFilter(query);
        if (box) {
            return box[method](sanitizeQuery(query));
        }
        let { checkpoint, filter = {}, orderBy = {}, limit = 50 } = query;
        if (orderBy.property !== 'time') {
            throw new Error('expected orderBy "time"');
        }
        let { IN = {}, EQ = {}, GT = {}, LT = {} } = filter;
        if (!orderBy.desc) {
            if (!(checkpoint || GT.time || LT.time)) {
                throw new Error('expected GT.time and/or LT.time');
            }
        }
        let counterparty = EQ._counterparty;
        if (!counterparty) {
            const { _author, _recipient } = IN;
            if (!(_author && _recipient)) {
                throw new Error('expected IN._author and IN._recipient');
            }
            if (!equalsIgnoreOrder(_author, _recipient)) {
                throw new Error('expected IN._author and IN._recipient to be the same');
            }
            const identity = yield getMyIdentity();
            if (!_author.includes(identity._permalink)) {
                throw new Error(`expected one of the parties to be this bot: "${identity._permalink}"`);
            }
            counterparty = _author.find(permalink => permalink !== identity._permalink);
        }
        IN = omit(IN, ['_author', '_recipient']);
        EQ = omit(EQ, ['_counterparty']);
        const inboundFilter = Object.assign({}, filter, { IN, EQ: Object.assign({}, EQ, { _author: counterparty }) });
        const outboundFilter = Object.assign({}, filter, { IN, EQ: Object.assign({}, EQ, { _recipient: counterparty }) });
        filter.EQ = EQ;
        filter.IN = IN;
        const [inbound, outbound] = yield Promise.all([
            inbox[method](Object.assign({}, query, { filter: inboundFilter, checkpoint: checkpoint && checkpoint.inbound, limit })),
            outbox[method](Object.assign({}, query, { filter: outboundFilter, checkpoint: checkpoint && checkpoint.outbound, limit }))
        ]);
        const merged = mergeInboundOutbound({
            inbound,
            outbound,
            filter,
            orderBy,
            limit
        });
        return merged;
    });
    const mergeInboundOutbound = ({ inbound, outbound, filter, orderBy, limit }) => {
        let merged = [];
        const i = inbound.items.slice();
        const o = outbound.items.slice();
        const compare = (a, b) => dynamodb_1.utils.compare(a, b, orderBy.property, !orderBy.desc);
        let lastI;
        let lastO;
        while (i.length && o.length && merged.length < limit) {
            while (compare(i[0], o[0]) < 0) {
                lastI = i[0];
                merged.push(i.shift());
                if (merged.length === limit)
                    break;
            }
            if (merged.length === limit)
                break;
            lastO = o[0];
            merged.push(o.shift());
        }
        if (merged.length < limit) {
            if (i.length) {
                merged = merged.concat(i.slice(0, limit - merged.length));
                lastI = merged[merged.length - 1];
            }
            else if (o.length) {
                merged = merged.concat(o.slice(0, limit - merged.length));
                lastO = merged[merged.length - 1];
            }
        }
        const inboxQueryInfo = getQueryInfo({ table: inbox, filter, orderBy });
        const outboxQueryInfo = getQueryInfo({ table: outbox, filter, orderBy });
        const iStartPosition = inbound.items.length && inbound.itemToPosition(inbound.items[0]);
        const iEndPosition = lastI && inbound.itemToPosition(lastI);
        const oStartPosition = outbound.items.length && outbound.itemToPosition(outbound.items[0]);
        const oEndPosition = lastO && outbound.itemToPosition(lastO);
        const startPosition = {
            inbound: iStartPosition,
            outbound: oStartPosition
        };
        const endPosition = {
            inbound: iEndPosition,
            outbound: oEndPosition
        };
        const itemToPosition = item => {
            const pos = {};
            const inboundIdx = inbound.items.indexOf(item);
            const mergedCopy = orderBy.desc ? merged.slice().reverse() : merged;
            if (inboundIdx > -1) {
                pos.inbound = inboxQueryInfo.itemToPosition(item);
                const prevOutbound = mergedCopy.slice(mergedCopy.indexOf(item)).reverse().find(item => outbound.items.includes(item));
                if (prevOutbound) {
                    pos.outbound = outboxQueryInfo.itemToPosition(item);
                }
            }
            else {
                const outboundIdx = outbound.items.indexOf(item);
                if (outboundIdx === -1) {
                    throw new Error('invalid item, neither in inbound or outbound');
                }
                pos.outbound = outboxQueryInfo.itemToPosition(item);
                const prevInbound = mergedCopy.slice(mergedCopy.indexOf(item)).reverse().find(item => inbound.items.includes(item));
                if (prevInbound) {
                    pos.inbound = inboxQueryInfo.itemToPosition(item);
                }
            }
            return pos;
        };
        return {
            items: merged,
            itemToPosition,
            startPosition,
            endPosition,
            index: inbound.index
        };
    };
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
const equalsIgnoreOrder = (a, b) => {
    return a.length === b.length &&
        a.every(str => b.includes(str));
};
//# sourceMappingURL=messages-table.js.map