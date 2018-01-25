"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("../utils");
const LAUNCH_STACK_BASE_URL = 'https://console.aws.amazon.com/cloudformation/home';
const REGIOn = 'us-east-1';
console.log(utils_1.launchStackUrl({
    templateURL: process.argv[2],
    region: 'us-east-1',
    stackName: 'tradle'
}));
//# sourceMappingURL=getlaunchstackurl.js.map