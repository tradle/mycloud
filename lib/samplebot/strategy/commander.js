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
const constants_1 = require("@tradle/constants");
const utils_1 = require("./utils");
const COMMAND_REGEX = /^\/?([^\s]+)\s*(.*)?$/;
const DEFAULT_ERROR_MESSAGE = `sorry, I don't understand. To see the list of supported commands, type: /help`;
class Commander {
    constructor({ bot, productsAPI, employeeManager, conf }) {
        this.bot = bot;
        this.productsAPI = productsAPI;
        this.employeeManager = employeeManager;
        this.conf = conf;
        this.logger = bot.logger.sub('cli');
    }
    exec({ req, command }) {
        return __awaiter(this, void 0, void 0, function* () {
            this.logger.debug(`processing command: ${command}`);
            const isEmployee = this.employeeManager.isEmployee(req.user);
            const [commandName, argsStr = ''] = command.match(COMMAND_REGEX).slice(1);
            const commandNames = utils_1.getAvailableCommands({ context: this, req });
            if (!commandNames.includes(commandName)) {
                const message = isEmployee
                    ? `command not found: ${commandName}`
                    : DEFAULT_ERROR_MESSAGE;
                yield this.sendSimpleMessage({ req, message });
                return;
            }
            try {
                const matchingCommand = utils_1.getCommandByName(commandName);
                yield matchingCommand.exec({
                    context: this,
                    req,
                    command: argsStr
                });
            }
            catch (err) {
                this.logger.debug(`failed to process command: ${command}`, err.stack);
                const message = isEmployee
                    ? err.message
                    : DEFAULT_ERROR_MESSAGE;
                yield this.sendSimpleMessage({ req, message });
            }
        });
    }
    sendSimpleMessage({ req, to, message }) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!to)
                to = req.user;
            yield this.productsAPI.send({
                req,
                to,
                object: {
                    [constants_1.TYPE]: 'tradle.SimpleMessage',
                    message
                }
            });
        });
    }
}
exports.Commander = Commander;
//# sourceMappingURL=commander.js.map