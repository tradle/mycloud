require('./env').install();
const test = require('tape');
const Cache = require('lru-cache');
const sinon = require('sinon');
const { getFavicon } = require('../image-utils');
const { randomString, sha256 } = require('../crypto');
const { co, loudCo, cachify, clone, batchStringsBySize } = require('../utils');
const wrap = require('../wrap');
const { tradle } = require('../');
test('cachify', loudCo(function* (t) {
    const data = {
        a: 1
    };
    const misses = {};
    const raw = {
        get: co(function* (key, value) {
            misses[key] = (misses[key] || 0) + 1;
            if (key in data)
                return data[key];
            throw new Error('not found');
        }),
        put: co(function* (key, value) {
            data[key] = value;
        }),
        cache: new Cache({ max: 100 })
    };
    const cachified = cachify(raw);
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
}));
test('wrap', loudCo(function* (t) {
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
    const good = values(originals.good).map(wrap);
    const bad = values(originals.bad).map(wrap);
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
}));
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
    t.same(batchStringsBySize(input, MAX), expected);
    t.end();
});
test('getCacheable', loudCo(function* (t) {
    const { aws, s3Utils } = tradle;
    const { s3 } = aws;
    const bucketName = `test-${Date.now()}-${randomString(10)}`;
    yield s3.createBucket({ Bucket: bucketName }).promise();
    const key = 'a';
    const bucket = s3Utils.getBucket(bucketName);
    const cacheable = bucket.getCacheable({
        key,
        parse: JSON.parse.bind(JSON),
        ttl: 100
    });
    try {
        yield cacheable.get(key);
        t.fail('expected error');
    }
    catch (err) {
        t.equal(err.name, 'NotFound');
    }
    let value = { a: 1 };
    yield bucket.putJSON(key, value);
    const getObjectSpy = sinon.spy(s3, 'getObject');
    t.same(yield cacheable.get(key), value);
    t.equal(getObjectSpy.callCount, 1);
    t.same(yield cacheable.get(key), value);
    t.equal(getObjectSpy.callCount, 1);
    value = { a: 2 };
    yield bucket.putJSON(key, value);
    yield new Promise(resolve => setTimeout(resolve, 200));
    t.same(yield cacheable.get(key), value);
    t.equal(getObjectSpy.callCount, 2);
    t.same(yield cacheable.get(key), value);
    t.equal(getObjectSpy.callCount, 2);
    getObjectSpy.restore();
    yield bucket.del(key);
    yield s3.deleteBucket({ Bucket: bucketName }).promise();
    t.end();
}));
test('content-addressed-storage', loudCo(function* (t) {
    const { contentAddressedStorage } = tradle;
    const key = yield contentAddressedStorage.put('a');
    t.equal(key, sha256('a', 'hex'));
    t.end();
}));
test('key-value table', loudCo(function* (t) {
    const { conf } = tradle;
    yield conf.put('a', {
        b: 'c'
    });
    t.same(yield conf.get('a'), {
        b: 'c'
    });
    const sub = conf.sub('mynamespace');
    yield sub.put('a', {
        d: 'e'
    });
    t.same(yield conf.get('mynamespacea'), {
        d: 'e'
    });
    t.end();
}));
function values(obj) {
    return Object.keys(obj).map(key => obj[key]);
}
//# sourceMappingURL=utils.test.js.map