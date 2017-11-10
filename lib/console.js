const pick = require('object.pick');
const extend = require('xtend/mutable');
const { SERVERLESS_PREFIX, AWS_LAMBDA_FUNCTION_NAME } = process.env;
const METHODS = [
    'log',
    'warn',
    'info',
    'dir',
    'table'
];
const original = pick(console, METHODS);
exports.restore = () => extend(console, original);
exports.prefix = function prefix(str) {
    const current = pick(console, METHODS);
    METHODS.forEach(method => {
        const fn = console[method];
        if (!fn)
            return;
        console[method] = function (...args) {
            args.unshift(str);
            return fn.apply(console, args);
        };
    });
    const restore = () => extend(console, current);
    return restore;
};
if (SERVERLESS_PREFIX && AWS_LAMBDA_FUNCTION_NAME) {
    const name = AWS_LAMBDA_FUNCTION_NAME.startsWith(SERVERLESS_PREFIX)
        ? AWS_LAMBDA_FUNCTION_NAME.slice(SERVERLESS_PREFIX.length)
        : AWS_LAMBDA_FUNCTION_NAME;
    exports.prefix(`λ:${name}`);
}
//# sourceMappingURL=console.js.map