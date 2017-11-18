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
const registrar = {};
class Command {
    constructor(cli) {
        this.confirm = (message) => __awaiter(this, void 0, void 0, function* () { return this.cli.confirm(message); });
        this.cli = cli;
        this.tradle = cli.tradle;
        this.env = this.tradle.env;
        this.bot = bot;
    }
}
exports.Command = Command;
exports.register = (name, command) => {
    registrar[name] = command;
};
exports.create = ({ name, cli }) => {
    const ctor = registrar[name];
    if (!name) {
        throw new Error(`command "${name}" not found`);
    }
    return ctor(cli);
};
exports.register('clear-tables', require('./clear-tables'));
//# sourceMappingURL=index.js.map