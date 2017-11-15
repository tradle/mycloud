"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const requireDefault = (() => {
    const cache = {};
    return (path) => {
        if (!cache[path]) {
            const result = require(path);
            cache[path] = result.__esModule && result.default ? result.default : result;
        }
        return cache[path];
    };
})();
exports.requireDefault = requireDefault;
//# sourceMappingURL=require-default.js.map