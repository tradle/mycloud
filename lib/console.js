"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const lodash_1 = require("lodash");
const { SERVERLESS_PREFIX, AWS_LAMBDA_FUNCTION_NAME } = process.env;
const METHODS = [
    'log',
    'warn',
    'info',
    'dir',
    'table'
];
const original = lodash_1.pick(console, METHODS);
exports.restore = () => lodash_1.extend(console, original);
exports.prefix = function prefix(str) {
    const current = lodash_1.pick(console, METHODS);
    METHODS.forEach(method => {
        const fn = console[method];
        if (!fn)
            return;
        console[method] = function (...args) {
            args.unshift(str);
            return fn.apply(console, args);
        };
    });
    const restore = () => lodash_1.extend(console, current);
    return restore;
};
if (SERVERLESS_PREFIX && AWS_LAMBDA_FUNCTION_NAME) {
    const name = AWS_LAMBDA_FUNCTION_NAME.startsWith(SERVERLESS_PREFIX)
        ? AWS_LAMBDA_FUNCTION_NAME.slice(SERVERLESS_PREFIX.length)
        : AWS_LAMBDA_FUNCTION_NAME;
    exports.prefix(`λ:${name}`);
}
//# sourceMappingURL=console.js.map