"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
        this.formatOutput = (level, msg, params) => {
            if (this.outputFormat === 'json') {
                const logMsg = Object.assign({ msg, namespace: this.namespace, time: new Date().toISOString(), level }, this.context);
                if (params)
                    logMsg.params = params;
                return JSON.stringify(logMsg);
            }
            const stringifiedParams = params ? JSON.stringify(params) : '';
            let part1 = this.namespace;
            if (part1)
                part1 += ':';
            return `${part1}${level}: ${msg} ${stringifiedParams}`;
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
//# sourceMappingURL=logger.js.map