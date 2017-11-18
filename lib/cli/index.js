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
const remoteServiceMap = require("./remote-service-map");
const testServiceMap = require("../test/service-map");
const bot_1 = require("../samplebot/bot");
const providerConf = require("../../conf/provider");
const commands_1 = require("./commands");
let instance;
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
        if (instance)
            throw new Error('only one instance allowed');
        this.remote = !!remote;
        const serviceMap = remote ? remoteServiceMap : testServiceMap;
        const processEnv = Object.assign({}, serviceMap, providerConf.env, process.env);
        if (!this.remote) {
            processEnv.IS_LOCAL = true;
            processEnv.IS_OFFLINE = true;
        }
        Object.assign(process.env, processEnv);
        const { tradle, bot, productsAPI, onfidoPlugin } = bot_1.default(processEnv);
        this.tradle = tradle;
        this.bot = bot;
        this.productsAPI = productsAPI;
        this.onfidoPlugin = onfidoPlugin;
        this.env = this.tradle.env;
        this.logger = this.env.sublogger(':cli');
    }
    setWriter(writer, propagateToSubWriters) {
        this.logger.setWriter(writer, propagateToSubWriters);
    }
}
exports.default = Cli;
//# sourceMappingURL=index.js.map