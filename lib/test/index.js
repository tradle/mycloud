"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const fs = require("fs");
fs.readdirSync(__dirname).forEach(file => {
    if (file.endsWith('.test.js')) {
        require(path.join(__dirname, file));
    }
});
//# sourceMappingURL=index.js.map