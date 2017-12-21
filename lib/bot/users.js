"use strict";
const events_1 = require("events");
const utils_1 = require("../utils");
const db_utils_1 = require("../db-utils");
const Errors = require("../errors");
const PRIMARY_KEY = 'id';
function getKey(user) {
    return utils_1.pick(user, PRIMARY_KEY);
}
function getProps(user) {
    return utils_1.omit(user, PRIMARY_KEY);
}
module.exports = function createUsers({ table, oncreate }) {
    const ee = new events_1.EventEmitter();
    const save = user => table.put({ Item: user }).then(() => user);
    const del = primaryKey => table.del({
        Key: { [PRIMARY_KEY]: primaryKey },
        ReturnValues: 'ALL_OLD'
    });
    const merge = function merge(user) {
        return table.update(utils_1.extend({
            Key: getKey(user),
            ReturnValues: 'ALL_NEW',
        }, db_utils_1.getUpdateParams(getProps(user))));
    };
    const list = table.scan;
    const createIfNotExists = utils_1.co(function* (user) {
        try {
            return yield get(user[PRIMARY_KEY]);
        }
        catch (err) {
            if (err instanceof Errors.NotFound) {
                yield save(user);
                yield oncreate(user);
                return user;
            }
            throw err;
        }
    });
    const get = primaryKey => table.get({
        Key: { [PRIMARY_KEY]: primaryKey },
        ConsistentRead: true
    });
    return utils_1.extend(ee, {
        get,
        createIfNotExists,
        save,
        del,
        merge,
        list
    });
};
//# sourceMappingURL=users.js.map