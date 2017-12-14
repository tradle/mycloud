#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("../cli/utils");
const argv = require('minimist')(process.argv.slice(2), {
    alias: {
        s: 'source',
        d: 'destination',
        t: 'type'
    }
});
const { source, destination, type } = argv;
if (!(source && destination)) {
    throw new Error('expected "source" and "destination"');
}
const types = [].concat(type);
utils_1.loadCredentials();
utils_1.cloneRemoteBucket({
    source,
    destination,
    filter: item => types.includes(JSON.parse(item.Body)._t)
}).catch(err => {
    console.error(err.stack);
    process.exitCode = 1;
});
//# sourceMappingURL=clone-remote-objects.js.map