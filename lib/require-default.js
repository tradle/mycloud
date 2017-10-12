exports.requireDefault = (() => {
    const cache = {};
    return (path) => {
        if (!cache[path]) {
            const result = require(path);
            cache[path] = result.__esModule ? result.default : result;
        }
        return cache[path];
    };
})();
//# sourceMappingURL=require-default.js.map