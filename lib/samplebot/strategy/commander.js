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
const prettify = obj => JSON.stringify(obj, null, 2);
const COMMAND_REGEX = /^\/?([^\s]+)\s*(.*)?\s*$/;
const DEFAULT_ERROR_MESSAGE = `sorry, I don't understand. To see the list of supported commands, type: /help`;
const SUDO = {
    employee: true,
    allowed: true
};
class Commander {
    constructor({ bot, productsAPI, employeeManager, conf }) {
        this.auth = (ctx) => __awaiter(this, void 0, void 0, function* () {
            if (ctx.sudo) {
                ctx.allowed = true;
                return;
            }
            const { req, commandName } = ctx;
            if (!req.user) {
                throw new Error(`cannot authenticate, don't know user`);
            }
            const { user } = req;
            ctx.employee = this.employeeManager.isEmployee(user);
            const commandNames = utils_1.getAvailableCommands(ctx);
            ctx.allowed = commandNames.includes(commandName);
            if (!ctx.allowed) {
                const message = ctx.employee
                    ? `command not found: ${commandName}`
                    : DEFAULT_ERROR_MESSAGE;
                yield this.sendSimpleMessage({ to: user, message });
            }
        });
        this.exec = ({ req, command, sudo = false }) => __awaiter(this, void 0, void 0, function* () {
            const ret = {};
            this.logger.debug(`processing command: ${command}`);
            if (!req)
                req = this.productsAPI.state.newRequestState({});
            const { user } = req;
            const match = command.match(COMMAND_REGEX);
            if (!match) {
                throw new Error(`received malformed command: ${command}`);
            }
            const [commandName, argsStr = ''] = match.slice(1);
            const ctx = {
                commandName,
                argsStr,
                sudo,
                allowed: sudo,
                req
            };
            yield this.auth(ctx);
            if (!ctx.allowed)
                return ret;
            let result;
            let matchingCommand;
            let args;
            try {
                matchingCommand = utils_1.getCommandByName(commandName);
                args = matchingCommand.parse ? matchingCommand.parse(argsStr) : null;
                result = yield matchingCommand.exec({
                    commander: this,
                    req,
                    args,
                    argsStr,
                    ctx
                });
            }
            catch (err) {
                this.logger.debug(`failed to process command: ${command}`, err.stack);
                ret.error = {
                    message: err.message
                };
                if (user) {
                    const message = ctx.employee
                        ? err.message
                        : DEFAULT_ERROR_MESSAGE;
                    yield this.sendSimpleMessage({ req, to: user, message });
                }
                return ret;
            }
            if (user) {
                const opts = { context: this, req, to: user, result, args, argsStr };
                if (matchingCommand.sendResult) {
                    yield matchingCommand.sendResult(opts);
                }
                else {
                    yield this.sendResult(opts);
                }
            }
            ret.result = result;
            return ret;
        });
        this.sendResult = ({ req, to, result }) => __awaiter(this, void 0, void 0, function* () {
            if (!result)
                return;
            const message = typeof result === 'string' ? result : prettify(result);
            yield this.sendSimpleMessage({ req, to, message });
        });
        this.send = (opts) => __awaiter(this, void 0, void 0, function* () {
            return yield this.productsAPI.send(opts);
        });
        this.sendSimpleMessage = ({ req, to, message }) => __awaiter(this, void 0, void 0, function* () {
            return yield this.send({
                req,
                to: to || req.user,
                object: {
                    [constants_1.TYPE]: 'tradle.SimpleMessage',
                    message
                }
            });
        });
        this.bot = bot;
        this.productsAPI = productsAPI;
        this.employeeManager = employeeManager;
        this.conf = conf;
        this.logger = bot.logger.sub('cli');
    }
}
exports.Commander = Commander;
//# sourceMappingURL=commander.js.map