"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("@tradle/constants");
const parse = require("yargs-parser");
exports.command = {
    name: 'message',
    description: 'sends a message',
    examples: [
        '/message --to <userId> --message "hey there"'
    ],
    parse: (argsStr) => {
        const args = parse(argsStr);
        const { to, message } = args;
        if (!(to && message)) {
            throw new Error('"to" and "message" are required');
        }
        return {
            to: args.to,
            object: {
                [constants_1.TYPE]: 'tradle.SimpleMessage',
                message: args.message
            }
        };
    },
    exec: ({ commander, args }) => commander.bot.send(args)
};
//# sourceMappingURL=message.js.map