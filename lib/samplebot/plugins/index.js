"use strict";
const path = require("path");
const fs = require("fs");
const plugins = {};
fs.readdirSync(__dirname).forEach(file => {
    if (file !== 'index.js' && file.endsWith('.js')) {
        const plugin = require(path.resolve(__dirname, file));
        const name = plugin.name || path.parse(file).name;
        plugins[name] = plugin;
    }
});
plugins['customize-message'] = require('@tradle/plugin-customize-message');
module.exports = plugins;
//# sourceMappingURL=index.js.map