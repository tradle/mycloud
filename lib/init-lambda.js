"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const module_1 = require("module");
const { _load } = module_1.Module;
module_1.Module._load = function (name, parent) {
    if (require.track) {
        console.log('REQUIRING AT LAMBDA EXECUTION TIME (not recommended)', name);
    }
    return _load.apply(this, arguments);
};
require("time-require");
process.env.LAMBDA_BIRTH_DATE = Date.now();
require("./globals");
//# sourceMappingURL=init-lambda.js.map