"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
require('./env').install();
const test = require("tape");
const Cache = require("lru-cache");
const sinon = require("sinon");
const key_value_table_1 = require("../key-value-table");
const crypto_1 = require("../crypto");
const utils_1 = require("../utils");
const utils_2 = require("./utils");
const Errors = require("../errors");
const definitions_1 = require("../definitions");
const aliceKeys = require("./fixtures/alice/keys");
const _1 = require("../");
const bucket_1 = require("../bucket");
const tradle = new _1.Tradle();
const { dbUtils } = tradle;
test('cachify', utils_2.loudAsync((t) => __awaiter(this, void 0, void 0, function* () {
    const data = {
        a: 1
    };
    const misses = {};
    const raw = {
        get: (key, value) => __awaiter(this, void 0, void 0, function* () {
            misses[key] = (misses[key] || 0) + 1;
            if (key in data)
                return data[key];
            throw new Error('not found');
        }),
        put: (key, value) => __awaiter(this, void 0, void 0, function* () {
            data[key] = value;
        }),
        cache: new Cache({ max: 100 })
    };
    const cachified = utils_1.cachify(raw);
    t.equal(yield cachified.get('a'), data.a);
    t.equal(misses.a, 1);
    t.equal(yield cachified.get('a'), data.a);
    t.equal(misses.a, 1);
    cachified.put('a', 2);
    t.equal(yield cachified.get('a'), data.a);
    t.equal(misses.a, 2);
    cachified.put('a', 3);
    const miss = cachified.get('a');
    const hit = cachified.get('a');
    t.equal(yield miss, data.a);
    t.equal(misses.a, 3);
    t.equal(yield hit, data.a);
    t.end();
})));
test('wrap', utils_2.loudAsync((t) => __awaiter(this, void 0, void 0, function* () {
    const lambdaUtils = require('../lambda-utils');
    const { performServiceDiscovery } = lambdaUtils;
    lambdaUtils.performServiceDiscovery = () => Promise.resolve();
    const expectedRet = {
        something: 'good'
    };
    const expectedError = new Error('blah happened');
    const originals = {
        good: {
            generatorSuccess: function* () {
                return expectedRet;
            },
            promiserSuccess: function () {
                return Promise.resolve(expectedRet);
            },
            syncSuccess: function () {
                return expectedRet;
            }
        },
        bad: {
            generatorError: function* () {
                throw expectedError;
            },
            promiserError: function () {
                return Promise.reject(expectedError);
            },
            syncError: function () {
                throw expectedError;
            }
        }
    };
    const good = values(originals.good).map(utils_1.wrap);
    const bad = values(originals.bad).map(utils_1.wrap);
    let togo = good.length * 2 + bad.length;
    yield good.map(lambda => {
        return new Promise(resolve => {
            lambda({}, {}, function (err, result) {
                t.error(err);
                t.same(result, expectedRet);
                resolve();
            });
        });
    });
    yield bad.map(lambda => {
        return new Promise(resolve => {
            lambda({}, {}, function (err, result) {
                t.equal(err, expectedError);
                resolve();
            });
        });
    });
    lambdaUtils.performServiceDiscovery = performServiceDiscovery;
    t.end();
})));
test('batch by size', function (t) {
    const sampleJSON = {
        blah: 1,
        url: 'http://blah.com/blah?blah=blah#blah=blah%$^*)_@#*('
    };
    const s = JSON.stringify(sampleJSON);
    const length = Buffer.byteLength(s, 'utf8');
    const MAX = length;
    const oneThird = Math.floor(length / 3);
    const twoFifths = Math.floor(2 * length / 5);
    const threeFifths = Math.floor(3 * length / 5);
    const leftOver = length - twoFifths - threeFifths;
    const expected = [
        [
            s,
        ],
        [
            s.slice(0, oneThird),
            s.slice(0, oneThird),
            s.slice(0, oneThird),
        ],
        [
            s.slice(0, twoFifths),
            s.slice(0, twoFifths),
        ],
        [
            s.slice(0, twoFifths),
            s.slice(0, threeFifths),
            'a'.repeat(leftOver)
        ],
        [
            'a'
        ]
    ];
    const input = expected.reduce((arr, next) => arr.concat(next), []);
    t.same(utils_1.batchStringsBySize(input, MAX), expected);
    t.end();
});
test('getCacheable', utils_2.loudAsync((t) => __awaiter(this, void 0, void 0, function* () {
    const { aws } = tradle;
    const { s3 } = aws;
    const bucketName = `test-${Date.now()}-${crypto_1.randomString(10)}`;
    const bucket = new bucket_1.default({ name: bucketName, s3 });
    yield bucket.create();
    const key = 'a';
    const cacheable = bucket.getCacheable({
        key,
        parse: JSON.parse.bind(JSON),
        ttl: 100
    });
    try {
        yield cacheable.get();
        t.fail('expected error');
    }
    catch (err) {
        t.equal(err.name, 'NotFound');
    }
    let value = { a: 1 };
    yield cacheable.put({ value });
    const getObjectSpy = sinon.spy(s3, 'getObject');
    t.same(yield cacheable.get(), value);
    t.equal(getObjectSpy.callCount, 0);
    t.same(yield cacheable.get(), value);
    t.equal(getObjectSpy.callCount, 0);
    value = { a: 2 };
    yield bucket.putJSON(key, value);
    yield new Promise(resolve => setTimeout(resolve, 200));
    t.same(yield cacheable.get(), value);
    t.equal(getObjectSpy.callCount, 1);
    t.same(yield cacheable.get(), value);
    t.equal(getObjectSpy.callCount, 1);
    getObjectSpy.restore();
    yield bucket.del(key);
    yield s3.deleteBucket({ Bucket: bucketName }).promise();
    t.end();
})));
test('content-addressed-storage', utils_2.loudAsync((t) => __awaiter(this, void 0, void 0, function* () {
    const { contentAddressedStorage } = tradle;
    const key = yield contentAddressedStorage.put('a');
    t.equal(key, crypto_1.sha256('a', 'hex'));
    t.end();
})));
test('key-value table', utils_2.loudAsync((t) => __awaiter(this, void 0, void 0, function* () {
    const newTableName = 'kvTable' + Date.now();
    const { aws } = tradle;
    yield aws.dynamodb.createTable(Object.assign({}, definitions_1.KVTable.Properties, { TableName: newTableName })).promise();
    const table = dbUtils.getTable(newTableName);
    const conf = new key_value_table_1.default({ table });
    t.equal(yield conf.exists('a'), false);
    yield conf.put('a', {
        b: 'c',
        age: 75
    });
    t.equal(yield conf.exists('a'), true);
    t.same(yield conf.get('a'), {
        b: 'c',
        age: 75
    });
    const update = yield conf.update('a', {
        UpdateExpression: 'SET #value.#age = #value.#age + :incr',
        ExpressionAttributeNames: {
            '#value': 'value',
            '#age': 'age'
        },
        ExpressionAttributeValues: {
            ':incr': 1
        },
        ReturnValues: 'UPDATED_NEW'
    });
    t.same(update.age, 76);
    const sub = conf.sub('mynamespace:');
    t.equal(yield sub.exists('a'), false);
    try {
        yield sub.get('mynamespace:a');
        t.fail('sub should not have value');
    }
    catch (err) {
        t.ok(err);
    }
    yield sub.put('a', {
        d: 'e'
    });
    t.equal(yield sub.exists('a'), true);
    t.same(yield sub.get('a'), {
        d: 'e'
    });
    t.equal(yield conf.exists('mynamespace:a'), true);
    t.same(yield conf.get('mynamespace:a'), {
        d: 'e'
    });
    yield table.destroy();
    t.end();
})));
test('errors', function (t) {
    ;
    [
        {
            error: new TypeError('bad type'),
            matches: [
                { type: 'system', result: true },
                { type: { message: 'bad type' }, result: true },
                { type: { message: /bad type/ }, result: true },
                { type: {}, result: true }
            ]
        },
        {
            error: (() => {
                const err = new Error('resource not found');
                err.code = 'ResourceNotFoundException';
                err.name = 'somename';
                return err;
            })(),
            matches: [
                {
                    type: 'system',
                    result: false
                },
                {
                    type: {
                        code: 'ResourceNotFoundException'
                    },
                    result: true
                },
                {
                    type: {
                        code: 'ResourceNotFoundException',
                        name: 'someothername'
                    },
                    result: false
                },
                { type: {}, result: true }
            ]
        },
    ].forEach(({ error, matches }) => {
        matches.forEach(({ type, result }) => {
            t.equal(Errors.matches(error, type), result);
        });
    });
    t.end();
});
test('sign/verify', utils_2.loudAsync((t) => __awaiter(this, void 0, void 0, function* () {
    const key = aliceKeys.find(key => key.type === 'ec');
    const sig = crypto_1.rawSign(key.encoded.pem.priv, 'a');
    t.ok(crypto_1.rawVerify(key.encoded.pem.pub, 'a', new Buffer(sig, 'hex')));
    t.notOk(crypto_1.rawVerify(key.encoded.pem.pub, 'a1', sig));
    const ecKey = new crypto_1.ECKey(key);
    const sig1 = ecKey.signSync('b');
    t.ok(ecKey.verifySync('b', sig1));
    t.notOk(ecKey.verifySync('b', sig));
    t.notOk(ecKey.verifySync('b1', sig1));
    const sig2 = yield utils_1.promisify(ecKey.sign)('c');
    t.ok(yield utils_1.promisify(ecKey.verify)('c', sig2));
    t.notOk(yield utils_1.promisify(ecKey.verify)('c', sig));
    t.notOk(yield utils_1.promisify(ecKey.verify)('c1', sig2));
    const sig3 = yield ecKey.promiseSign('d');
    t.ok(yield ecKey.promiseVerify('d', sig3));
    t.notOk(yield ecKey.promiseVerify('d', sig));
    t.notOk(yield ecKey.promiseVerify('d1', sig3));
    t.end();
})));
function values(obj) {
    return Object.keys(obj).map(key => obj[key]);
}
//# sourceMappingURL=utils.test.js.map