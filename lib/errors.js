"use strict";
const lodash_1 = require("lodash");
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
    ],
    developer: [
        'system',
        {
            code: 'ValidationException'
        }
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
    if (Array.isArray(type)) {
        return type.some(subType => matches(err, subType));
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
        else if (!lodash_1.isEqual(expected, actual)) {
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
const _HttpError = createError('HttpError');
class ExportableError extends Error {
    constructor() {
        super(...arguments);
        this.toJSON = () => exportError(this);
    }
}
class HttpError extends ExportableError {
    constructor(code, message) {
        super(message);
        this.toJSON = () => (Object.assign({}, exportError(this), { status: this.status }));
        this.status = code || 500;
    }
}
class ErrorWithLink extends ExportableError {
    constructor(message, link) {
        super(message);
        this.toJSON = () => (Object.assign({}, exportError(this), { link: this.link }));
        this.link = link;
    }
}
class Duplicate extends ErrorWithLink {
}
class TimeTravel extends ErrorWithLink {
}
const exportError = (err) => lodash_1.pick(err, ['message', 'stack', 'name', 'type']);
const errors = {
    ClientUnreachable: createError('ClientUnreachable'),
    NotFound: createError('NotFound'),
    InvalidSignature: createError('InvalidSignature'),
    InvalidAuthor: createError('InvalidAuthor'),
    UnknownAuthor: createError('UnknownAuthor'),
    InvalidVersion: createError('InvalidVersion'),
    InvalidMessageFormat: createError('InvalidMessageFormat'),
    InvalidObjectFormat: createError('InvalidObjectFormat'),
    PutFailed: createError('PutFailed'),
    MessageNotForMe: createError('MessageNotForMe'),
    HandshakeFailed: createError('HandshakeFailed'),
    LambdaInvalidInvocation: createError('LambdaInvalidInvocation'),
    InvalidInput: createError('InvalidInput'),
    ClockDrift: createError('ClockDrift'),
    BatchPutFailed: createError('BatchPutFailed'),
    ErrorWithLink,
    Duplicate,
    TimeTravel,
    ExecutionTimeout: createError('ExecutionTimeout'),
    Exists: createError('Exists'),
    HttpError,
    Timeout: createError('Timeout'),
    export: (err) => {
        if (err instanceof ExportableError) {
            return err.toJSON();
        }
        return exportError(err);
    },
    isDeveloperError: (err) => {
        return matches(err, 'developer');
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