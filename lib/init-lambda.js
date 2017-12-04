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
process.env.LAMBDA_BIRTH_DATE = Date.now();
require('source-map-support').install();
require("./globals");
const _1 = require("./");
const { env, lambdaUtils } = _1.tradle;
if (env.INVOKE_BOT_LAMBDAS_DIRECTLY) {
    if (env.FUNCTION_NAME === 'onmessage' ||
        env.FUNCTION_NAME === 'onmessage_http' ||
        env.FUNCTION_NAME === 'inbox') {
        lambdaUtils.requireLambdaByName(env.BOT_ONMESSAGE);
    }
}
//# sourceMappingURL=init-lambda.js.map