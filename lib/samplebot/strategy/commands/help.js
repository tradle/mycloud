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
exports.default = {
    name: 'help',
    description: 'see this menu, or the help for a particular command',
    examples: [
        '/help',
        '/help listproducts'
    ],
    exec: function ({ context, req, command }) {
        return __awaiter(this, void 0, void 0, function* () {
            const { employeeManager } = context;
            const commandName = parse(command)._[0];
            let message;
            if (commandName) {
                const c = utils_1.getCommandByName(commandName);
                message = c.description;
                if (c.examples) {
                    message = `${message}\n\nExamples:\n${c.examples.join('\n')}`;
                }
            }
            else {
                const availableCommands = utils_1.getAvailableCommands({ context, req })
                    .map(command => `/${command}`);
                message = `These are the available commands:\n${availableCommands.join('\n')}`;
            }
            yield context.sendSimpleMessage({ req, message });
        });
    }
};
//# sourceMappingURL=help.js.map