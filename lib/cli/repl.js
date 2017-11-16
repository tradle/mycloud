"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const repl = require("repl");
const co = require("co");
const pick = require("object.pick");
const repl_history_1 = require("./repl-history");
const utils_1 = require("../utils");
function createReplServer({ prompt, cli }) {
    const server = promisify(repl.start({
        prompt,
        ignoreUndefined: true
    }));
    repl_history_1.default({ prompt, server });
    const { context } = server;
    context.co = co;
    Object.assign(context, Object.assign({ cli }, pick(cli.tradle, [
        'env',
        'dbUtils',
        'lambdaUtils',
        'tables',
        'buckets',
        'objects',
        'secrets',
        'provider',
        'db',
        'messages',
        'identities',
        'friends',
        'seals',
        'blockchain',
        'auth',
        'kv',
        'conf'
    ])));
    return server;
}
exports.default = createReplServer;
function promisify(server) {
    const originalEval = server.eval;
    server.eval = function (cmd, context, filename, callback) {
        if (cmd.match(/\W*(?:yield|await)\s+/)) {
            cmd = 'co(function* () { return ' +
                cmd.replace(/(\W*)await(\s+)/g, '$1yield$2')
                    .replace(/^\s*var\s+/, '') +
                '})';
        }
        originalEval.call(server, cmd, context, filename, function (err, res) {
            if (err || !utils_1.isPromise(res)) {
                return callback(err, res);
            }
            res.then(result => callback(null, result), callback);
        });
    };
    return server;
}
//# sourceMappingURL=repl.js.map