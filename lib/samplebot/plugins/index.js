"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const fs = require("fs");
const Onfido = require("@tradle/plugin-onfido");
const Plugins = {};
exports.Plugins = Plugins;
fs.readdirSync(__dirname).forEach(file => {
    if (file !== 'index.js' && file.endsWith('.js')) {
        const plugin = require(path.resolve(__dirname, file));
        const name = plugin.name || path.parse(file).name;
        Plugins[name] = plugin;
    }
});
Plugins['customize-message'] = {
    createPlugin: require('@tradle/plugin-customize-message')
};
Plugins.onfido = Onfido;
//# sourceMappingURL=index.js.map