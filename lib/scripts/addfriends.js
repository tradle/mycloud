#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const promisify = require("pify");
const utils_1 = require("../cli/utils");
utils_1.loadRemoteEnv();
utils_1.loadCredentials();
const proc = promisify(require('child_process'));
const yml = require('../cli/serverless-yml');
const pathToFriendsFile = process.argv[2] || path.join(__dirname, '../samplebot/conf/friends.js');
const { stage = yml.custom.stage, friends } = require(pathToFriendsFile);
Promise.all(friends.map(({ domain, url }) => {
    const payload = JSON.stringify({ domain, url });
    const command = `echo '${payload}' | sls invoke --stage=${stage} -f addfriend`;
    console.log(`executing: ${command}`);
    return proc.exec(command, {
        cwd: process.cwd(),
        stdio: 'inherit'
    })
        .catch(console.error);
}))
    .catch(err => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=addfriends.js.map