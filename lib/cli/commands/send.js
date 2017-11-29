"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const command_1 = require("../command");
class Send extends command_1.default {
    constructor() {
        super(...arguments);
        this.exec = opts => this.bot.send(Object.assign({}, opts, { object: typeof opts.object === 'string'
                ? { _t: 'tradle.SimpleMessage', message: opts.object }
                : opts.object }));
    }
}
Send.description = 'sends a message';
exports.default = Send;
//# sourceMappingURL=send.js.map