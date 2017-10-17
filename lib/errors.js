"use strict";
const ex = require('error-ex');
function createError(name) {
    return ex(name);
}
const errors = {
    NotFound: createError('NotFound'),
    InvalidSignature: createError('InvalidSignature'),
    InvalidAuthor: createError('InvalidAuthor'),
    InvalidVersion: createError('InvalidVersion'),
    InvalidMessageFormat: createError('InvalidMessageFormat'),
    PutFailed: createError('PutFailed'),
    MessageNotForMe: createError('MessageNotForMe'),
    HandshakeFailed: createError('HandshakeFailed'),
    LambdaInvalidInvocation: createError('LambdaInvalidInvocation'),
    InvalidInput: createError('InvalidInput'),
    ClockDrift: createError('ClockDrift'),
    BatchPutFailed: createError('BatchPutFailed'),
    Duplicate: createError('Duplicate'),
    TimeTravel: createError('TimeTravel'),
    ExecutionTimeout: createError('ExecutionTimeout'),
    export: (err) => {
        return {
            type: err.name.toLowerCase(),
            message: err.message
        };
    },
    isDeveloperError: (err) => {
        return err instanceof TypeError || err instanceof ReferenceError || err instanceof SyntaxError;
    },
    isCustomError: (err) => {
        return err.name in errors;
    },
    is: (err, errType) => {
        const { name = '' } = err;
        return name.toLowerCase() === (errType || errType.type).toLowerCase();
    }
};
module.exports = errors;
//# sourceMappingURL=errors.js.map