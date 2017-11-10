require('./env').install();
const test = require('tape');
const buildResource = require('@tradle/build-resource');
const { loudCo, pick, clone, co } = require('../utils');
const { friends } = require('../').tradle;
const alice = require('./fixtures/alice/object');
const bob = require('./fixtures/bob/object');
test('function', loudCo(function* (t) {
    const friendOpts = {
        name: 'testfriend',
        url: 'http://localhost/friend',
        identity: alice.object
    };
    yield friends.add(friendOpts);
    const friend = yield friends.getByIdentityPermalink(alice.permalink);
    t.equal(friend.name, friendOpts.name);
    t.equal(friend.url, friendOpts.url);
    t.end();
}));
//# sourceMappingURL=friends.test.js.map