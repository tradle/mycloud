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
const fs = require("fs");
const path = require("path");
const mkdirp = require("mkdirp");
const minimist = require("minimist");
const _1 = require("./");
const repl_1 = require("./repl");
const registrar_1 = require("./registrar");
const { remote } = minimist(process.argv.slice(2), {
    alias: {
        r: 'remote'
    },
    default: {
        remote: false
    }
});
if (remote) {
    console.warn(`WARNING: this cli controls your remote AWS environment and resources`);
}
const logsDir = path.resolve(__dirname, '../../logs');
mkdirp.sync(logsDir);
const logPath = path.join(logsDir, `cli-log-${new Date().toISOString()}.log`);
const logStream = fs.createWriteStream(logPath, { 'flags': 'a' });
const cli = new _1.default({ remote });
(() => __awaiter(this, void 0, void 0, function* () {
    yield cli.ready;
    cli.setWriter({
        log: (...args) => {
            args.unshift(new Date().toLocaleString());
            const str = args.join(' ') + '\n';
            logStream.write(str);
        }
    }, true);
    registrar_1.list().forEach(name => {
        cli[name] = opts => cli.exec(name, opts);
    });
    repl_1.default({
        prompt: '\uD83C\uDF36  ',
        cli
    });
}))();
//# sourceMappingURL=cmd.js.map