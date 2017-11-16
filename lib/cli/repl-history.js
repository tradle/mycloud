"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const os = require("os");
const path = require("path");
const fs = require("fs");
function installHistory(opts) {
    const { prompt, server } = opts;
    const filename = promptToFilename(prompt) || '.tradle-cli-history';
    const historyPath = opts.path || path.join(os.homedir(), filename);
    if (fs.existsSync(historyPath)) {
        fs.readFileSync(historyPath, { encoding: 'utf8' })
            .split('\n')
            .reverse()
            .filter(line => line.trim())
            .forEach(line => server.history.push(line));
    }
    server.on('exit', function () {
        fs.appendFileSync(historyPath, '\n' + server.lines.join('\n'), { encoding: 'utf8' });
    });
}
exports.default = installHistory;
function promptToFilename(prompt) {
    const filename = prompt.replace(/[^a-zA-Z0-9\-_]+/g, '');
    if (filename)
        return '.' + filename;
}
//# sourceMappingURL=repl-history.js.map