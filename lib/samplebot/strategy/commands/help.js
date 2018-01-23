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
const parse = require("yargs-parser");
const utils_1 = require("../utils");
exports.command = {
    name: 'help',
    description: 'see this menu, or the help for a particular command',
    examples: [
        '/help',
        '/help listproducts'
    ],
    parse: (argsStr) => {
        return {
            commandName: parse(argsStr)._[0]
        };
    },
    exec: function ({ commander, req, ctx, args }) {
        return __awaiter(this, void 0, void 0, function* () {
            const { commandName } = args;
            const { employeeManager } = commander;
            let message;
            if (commandName) {
                const c = utils_1.getCommandByName(commandName);
                message = c.description;
                if (c.examples) {
                    message = `${message}\n\nExamples:\n${c.examples.join('\n')}`;
                }
            }
            else {
                const availableCommands = utils_1.getAvailableCommands(ctx)
                    .map(command => `/${command}`);
                message = `These are the available commands:\n${availableCommands.join('\n')}`;
            }
            yield commander.sendSimpleMessage({ req, message });
        });
    }
};
//# sourceMappingURL=help.js.map