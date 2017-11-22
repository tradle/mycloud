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
const commands_1 = require("./commands");
const COMMAND_REGEX = /^\/?([^\s]+)\s*(.*)?$/;
const DEFAULT_ERROR_MESSAGE = `sorry, I don't understand. To see the list of supported commands, type: /help`;
const EMPLOYEE_COMMANDS = [
    commands_1.help,
    commands_1.listproducts,
    commands_1.forgetme,
    commands_1.enableproduct,
    commands_1.disableproduct
];
const CUSTOMER_COMMANDS = [
    commands_1.help,
    commands_1.listproducts,
    commands_1.forgetme
];
class Commander {
    constructor({ bot, productsAPI, employeeManager, conf }) {
        this.bot = bot;
        this.productsAPI = productsAPI;
        this.employeeManager = employeeManager;
        this.conf = conf;
    }
    exec({ req, command }) {
        return __awaiter(this, void 0, void 0, function* () {
            const parts = command.match(COMMAND_REGEX);
            const isEmployee = this.employeeManager.isEmployee(req.user);
            const commands = isEmployee ? EMPLOYEE_COMMANDS : CUSTOMER_COMMANDS;
            const matchingCommand = commands.find(({ name, disabled }) => {
                return !disabled && name === parts[1];
            });
            if (!matchingCommand) {
                const message = isEmployee
                    ? `command not found: ${command}`
                    : DEFAULT_ERROR_MESSAGE;
                yield this.sendSimpleMessage({ req, message });
                return;
            }
            try {
                yield matchingCommand.exec({
                    context: this,
                    req,
                    command: parts[2] || ''
                });
            }
            catch (err) {
                this.bot.debug(`failed to process command: ${matchingCommand.name}`, err.stack);
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