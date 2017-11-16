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
const readline = require("readline");
const yn = require("yn");
const tradle_1 = require("../tradle");
const env_1 = require("../env");
const remoteServiceMap = require("./remote-service-map");
const testServiceMap = require("../test/service-map");
const commands_1 = require("./commands");
class Cli {
    constructor({ remote }) {
        this.exec = (name, opts) => __awaiter(this, void 0, void 0, function* () {
            const command = commands_1.create({ cli: this, name });
            return yield command.exec(opts);
        });
        this.confirm = (msg) => __awaiter(this, void 0, void 0, function* () {
            const rl = readline.createInterface(process.stdin, process.stdout);
            const answer = yield new Promise(resolve => {
                rl.question(`${msg}\ncontinue? y/[n]:`, resolve);
            });
            rl.close();
            if (!yn(answer)) {
                throw new Error('confirmation denied');
            }
        });
        this.remote = !!remote;
        const serviceMap = remote ? remoteServiceMap : testServiceMap;
        const env = new env_1.default(Object.assign({}, serviceMap, process.env, { console }));
        this.tradle = new tradle_1.default(env);
        this.logger = env.sublogger('cli');
        this.env = env;
    }
    setWriter(writer, propagateToSubWriters) {
        this.tradle.logger.setWriter(writer, propagateToSubWriters);
    }
}
exports.default = Cli;
//# sourceMappingURL=index.js.map