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
const customize_1 = require("../samplebot/customize");
const bot_1 = require("../bot");
const providerConf = require("../../conf/provider");
const registrar_1 = require("./registrar");
let instance;
class Cli {
    constructor({ remote }) {
        this.init = () => __awaiter(this, void 0, void 0, function* () {
            const bot = bot_1.createBot();
            this.bot = bot;
            this.env = bot.env;
            this.logger = this.env.sublogger(':cli');
            const { productsAPI, onfidoPlugin } = yield customize_1.customize({ bot });
            this.productsAPI = productsAPI;
            this.onfidoPlugin = onfidoPlugin;
        });
        this.exec = (name, opts) => __awaiter(this, void 0, void 0, function* () {
            yield this.ready;
            const ctor = registrar_1.get(name);
            const command = new ctor(this);
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
        this.ready = this.init();
    }
    setWriter(writer, propagateToSubWriters) {
        this.logger.setWriter(writer, propagateToSubWriters);
    }
}
exports.default = Cli;
//# sourceMappingURL=index.js.map