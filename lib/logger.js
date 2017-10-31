"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const debug = require('debug');
exports.Level = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    VERBOSE: 3,
    DEBUG: 4,
    SILLY: 5
};
const METHODS = {
    error: 'error',
    warn: 'warn',
    info: 'info',
    verbose: 'info',
    debug: 'info',
    silly: 'info',
};
const COLORS = {
    ERROR: 'red',
    WARN: 'yellow',
    INFO: 'blue',
    VERBOSE: 'cyan',
    SILLY: 'pink'
};
class Logger {
    constructor(conf) {
        this.setContext = (value) => {
            this.context = value;
            this.subloggers.forEach(logger => logger.setContext(this.context));
        };
        this.debug = (msg, params) => this.log('DEBUG', msg, params);
        this.info = (msg, params) => this.log('INFO', msg, params);
        this.warn = (msg, params) => this.log('WARN', msg, params);
        this.error = (msg, params) => this.log('ERROR', msg, params);
        this.logger = (conf) => {
            const sublogger = new Logger(Object.assign({}, this.conf, conf, { namespace: conf.namespace ? this.namespace + ':' + conf.namespace : '' }));
            this.subloggers.push(sublogger);
            return sublogger;
        };
        const { namespace = '', context = {}, level = exports.Level.DEBUG, pretty } = conf;
        this.conf = conf;
        this.namespace = namespace;
        this.context = context;
        this.level = level;
        if (level < 0 || level > 5) {
            throw new Error(`expected level >= 0 && level <=3, got ${level}`);
        }
        this.pretty = pretty;
        this.console = pretty
            ? { log: debug(this.namespace) }
            : console;
        this.subloggers = [];
    }
    log(level, msg, params) {
        if (level < exports.Level[level]) {
            return;
        }
        const logMsg = Object.assign({ msg, time: new Date().toISOString(), level }, this.context);
        if (params)
            logMsg.params = params;
        const { console } = this;
        const fn = console[METHODS[level]] || console.log;
        fn.call(console, JSON.stringify(logMsg));
    }
}
exports.default = Logger;
//# sourceMappingURL=logger.js.map