"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const send_1 = require("./commands/send");
const clear_tables_1 = require("./commands/clear-tables");
const commands = {};
exports.register = (name, command) => {
    commands[name] = command;
};
exports.get = name => {
    const ctor = commands[name];
    if (!name) {
        throw new Error(`command "${name}" not found`);
    }
    return ctor;
};
exports.list = () => Object.keys(commands);
exports.register('clear-tables', clear_tables_1.default);
exports.register('send', send_1.default);
//# sourceMappingURL=registrar.js.map