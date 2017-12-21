"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const clone = require("clone");
const utils_1 = require("../utils");
const promiseNoop = () => __awaiter(this, void 0, void 0, function* () { });
module.exports = function fakeUsers(opts = {}) {
    const { users = {}, oncreate = promiseNoop } = opts;
    return {
        get: utils_1.getter(users),
        merge: (user) => __awaiter(this, void 0, void 0, function* () {
            const { id } = user;
            if (!users[id]) {
                users[id] = user;
                return user;
            }
            users[id] = clone(users[id], user);
            return users[id];
        }),
        save: utils_1.putter(users),
        list: utils_1.scanner(users),
        createIfNotExists: (user) => __awaiter(this, void 0, void 0, function* () {
            if (!users[user.id]) {
                users[user.id] = user;
                yield oncreate(user);
            }
            return users[user.id];
        }),
        del: utils_1.deleter(users)
    };
};
//# sourceMappingURL=users.js.map