"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const stringifySafe = require("json-stringify-safe");
exports.Level = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    VERBOSE: 3,
    DEBUG: 4,
    SILLY: 5
};
const FORMATS = [
    'json',
    'text'
];
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
        this.setWriter = (writer, propagateToSubWriters) => {
            this.writer = writer;
            if (propagateToSubWriters) {
                this.subloggers.forEach(logger => logger.setWriter(writer, propagateToSubWriters));
            }
        };
        this.setContext = (value) => {
            this.context = value;
            this.subloggers.forEach(logger => logger.setContext(this.context));
        };
        this.silly = (msg, params) => this.log('SILLY', msg, params);
        this.debug = (msg, params) => this.log('DEBUG', msg, params);
        this.info = (msg, params) => this.log('INFO', msg, params);
        this.warn = (msg, params) => this.log('WARN', msg, params);
        this.error = (msg, params) => this.log('ERROR', msg, params);
        this.sub = (conf) => this.logger(conf);
        this.logger = (conf) => {
            if (typeof conf === 'string') {
                conf = { namespace: conf };
            }
            let { namespace = '' } = conf;
            if (namespace && this.namespace) {
                namespace = `${this.namespace}:${namespace}`;
            }
            const sublogger = new Logger(Object.assign({}, this.conf, conf, { namespace }));
            this.subloggers.push(sublogger);
            return sublogger;
        };
        this.time = (level, msg, params) => {
            const start = Date.now();
            return () => {
                const time = Date.now() - start;
                this.log(level, `${msg} (${time}ms)`, params);
            };
        };
        this.timeSilly = (msg, params) => this.time('SILLY', msg, params);
        this.timeDebug = (msg, params) => this.time('DEBUG', msg, params);
        this.timeInfo = (msg, params) => this.time('INFO', msg, params);
        this.timeWarn = (msg, params) => this.time('WARN', msg, params);
        this.timeError = (msg, params) => this.time('ERROR', msg, params);
        this.formatOutput = (level, msg, params) => {
            if (!params) {
                params = {};
            }
            if (typeof params !== 'object') {
                params = { value: params };
            }
            if (this.outputFormat === 'json') {
                const logMsg = Object.assign({ namespace: this.namespace, msg, time: new Date().toISOString(), level }, this.context);
                if (params)
                    logMsg.params = params;
                return stringifySafe(logMsg);
            }
            const stringifiedParams = params ? stringifySafe(Object.assign({ msg }, params)) : '';
            let part1 = this.namespace;
            if (part1)
                part1 += ':';
            return `${part1}${level}: ${stringifiedParams}`;
        };
        if (typeof conf === 'string') {
            conf = { namespace: conf };
        }
        const { namespace = '', context = {}, level = exports.Level.DEBUG, writer = global.console, outputFormat = 'json' } = conf;
        this.conf = conf;
        this.namespace = namespace;
        this.context = context;
        this.level = level;
        if (level < 0 || level > 5) {
            throw new Error(`expected level >= 0 && level <=3, got ${level}`);
        }
        this.writer = writer;
        this.outputFormat = outputFormat;
        if (!FORMATS.includes(outputFormat)) {
            throw new Error(`expected outputFormat to be one of: ${FORMATS.join(', ')}`);
        }
        this.subloggers = [];
    }
    log(level, msg, params) {
        if (this.level < exports.Level[level]) {
            return;
        }
        const output = this.formatOutput(level, msg, params);
        const { writer } = this;
        const fn = writer[METHODS[level]] || writer.log;
        fn.call(writer, output);
    }
}
exports.default = Logger;
exports.Logger = Logger;
//# sourceMappingURL=logger.js.map