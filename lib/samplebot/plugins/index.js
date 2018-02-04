"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const fs = require("fs");
const Onfido = require("@tradle/plugin-onfido");
exports.Plugins = {};
fs.readdirSync(__dirname).forEach(file => {
    if (file !== 'index.js' && file.endsWith('.js')) {
        const plugin = require(path.resolve(__dirname, file));
        const name = plugin.name || path.parse(file).name;
        exports.Plugins[name] = plugin;
    }
});
exports.Plugins['customize-message'] = {
    createPlugin: require('@tradle/plugin-customize-message')
};
exports.Plugins.onfido = Onfido;
//# sourceMappingURL=index.js.map