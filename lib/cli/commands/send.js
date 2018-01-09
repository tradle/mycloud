"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("@tradle/constants");
const command_1 = require("../command");
class Send extends command_1.default {
    constructor() {
        super(...arguments);
        this.parse = message => {
            return {
                [constants_1.TYPE]: 'tradle.SimpleMessage',
                message
            };
        };
        this.exec = opts => this.bot.send(opts);
    }
}
Send.description = 'sends a message';
exports.default = Send;
//# sourceMappingURL=send.js.map