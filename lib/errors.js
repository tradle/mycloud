"use strict";
const deepEqual = require("deep-equal");
const ex = require("error-ex");
const assert_1 = require("assert");
const typeforce_1 = require("typeforce");
function createError(name) {
    return ex(name);
}
const types = {
    system: [
        EvalError,
        RangeError,
        ReferenceError,
        SyntaxError,
        TypeError,
        URIError,
        assert_1.AssertionError,
        typeforce_1.TfTypeError,
        typeforce_1.TfPropertyTypeError
    ]
};
const isSystemError = err => types.system.some(ErrorCtor => {
    return err instanceof ErrorCtor;
});
const matches = (err, type) => {
    if (!(err && type)) {
        throw new Error('expected error and match parameters');
    }
    if (type === 'system') {
        return isSystemError(err);
    }
    if (typeof type === 'function' &&
        (err instanceof type || errors.is(err, type))) {
        return true;
    }
    for (let key in type) {
        let expected = type[key];
        let actual = err[key];
        if (expected instanceof RegExp) {
            if (!expected.test(actual)) {
                return false;
            }
        }
        else if (!deepEqual(expected, actual)) {
            return false;
        }
    }
    return true;
};
const ignore = (err, type) => {
    if (!matches(err, type)) {
        throw err;
    }
};
const rethrow = (err, type) => {
    if (matches(err, type)) {
        throw err;
    }
};
const errors = {
    ClientUnreachable: createError('ClientUnreachable'),
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
    Exists: createError('Exists'),
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
        const { type } = errType;
        if (!type)
            return false;
        const { name = '' } = err;
        return name.toLowerCase() === type.toLowerCase();
    },
    ignore,
    rethrow,
    matches
};
module.exports = errors;
//# sourceMappingURL=errors.js.map