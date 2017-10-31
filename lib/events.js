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
const { omit, extend } = require('./utils');
const { randomString } = require('./crypto');
const notNull = obj => !!obj;
const SEPARATOR = ':';
function createEvents({ env, tables, dbUtils }) {
    const logger = env.sublogger('events');
    const { Events, Seals, Inbox, Outbox } = tables;
    const putEvents = (events) => __awaiter(this, void 0, void 0, function* () {
        if (!events.length)
            return;
        setIds(events);
        try {
            yield Events.batchPut(events);
        }
        catch (err) {
            logger.error('failed to put events', { events, error: err.stack });
            throw err;
        }
    });
    const getEventId = event => {
        return event.data.time + SEPARATOR + event.topic + SEPARATOR + randomString(8);
    };
    const getNextUniqueId = (prev, next) => {
        return prev === next ? bumpSuffix(prev) : next;
    };
    const bumpSuffix = (id) => {
        const lastSepIdx = id.lastIndexOf(SEPARATOR);
        const main = id.slice(0, lastSepIdx);
        const suffix = id.slice(lastSepIdx + SEPARATOR.length);
        return main + SEPARATOR + (Number(suffix) + 1);
    };
    const setIds = (events) => {
        events.sort((a, b) => {
            return a.data.time - b.data.time;
        });
        events.forEach((event, i) => {
            let id = getEventId(event);
            if (i === 0) {
                event.id = id;
                return;
            }
            const prevId = events[i - 1].id;
            event.id = getNextUniqueId(prevId, id);
        });
        logger.debug('putting events', events.map(({ topic, id }) => ({ id, topic })));
        return events;
    };
    const getSealEventTopic = (change) => {
        if (change.old) {
            if (change.old.unsealed) {
                return 'seal:wrote';
            }
            if (change.new.confirmations > 0) {
                return 'seal:confirm';
            }
            return 'seal:read';
        }
        if (change.new.unsealed) {
            return 'seal:write';
        }
        return 'seal:watch';
    };
    const fromStreamEvent = (event) => {
        const changes = dbUtils.getRecordsFromEvent(event, true);
        const tableName = event.Records[0].eventSourceARN.match(/:table\/([^/]+)/)[1];
        return changes
            .map(change => transform(tableName, change))
            .filter(notNull);
    };
    const transform = (tableName, change) => {
        const item = change.new;
        switch (tableName) {
            case Seals.name:
                return {
                    topic: getSealEventTopic(change),
                    data: change.new
                };
            case Inbox.name:
                return {
                    topic: 'receive',
                    data: item
                };
            case Outbox.name:
                return {
                    topic: 'send',
                    data: item
                };
            default:
                logger.debug(`received unexpected stream event from table ${tableName}`, change);
                break;
        }
    };
    return {
        putEvents,
        fromStreamEvent
    };
}
exports.default = createEvents;
//# sourceMappingURL=events.js.map