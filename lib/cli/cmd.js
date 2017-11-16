"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const path = require("path");
const mkdirp = require("mkdirp");
const minimist = require("minimist");
const _1 = require("./");
const repl_1 = require("./repl");
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
cli.setWriter({
    log: (...args) => {
        args.unshift(new Date().toLocaleString());
        const str = args.join(' ') + '\n';
        logStream.write(str);
    }
}, true);
repl_1.default({
    prompt: '\uD83C\uDF36  ',
    cli
});
//# sourceMappingURL=cmd.js.map