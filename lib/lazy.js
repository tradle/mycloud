module.exports = function lazy(require, exports) {
    return function _require(name, path) {
        let cache;
        Object.defineProperty(exports, name, {
            enumerable: true,
            get: function () {
                if (!cache)
                    cache = require(path);
                return cache;
            }
        });
    };
};
//# sourceMappingURL=lazy.js.map