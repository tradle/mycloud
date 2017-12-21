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
const models_1 = require("@tradle/models");
const utils_1 = require("../utils");
const _1 = require("../");
const fakeResource = require('@tradle/build-resource/fake');
const { friends } = _1.createTestTradle();
const alice = require('./fixtures/alice/object');
const bob = require('./fixtures/bob/object');
test('friends', utils_1.loudAsync((t) => __awaiter(this, void 0, void 0, function* () {
    const friendOpts = {
        name: 'testfriend',
        url: 'http://localhost/friend',
        identity: alice.object,
        org: fakeResource({
            models: models_1.models,
            model: models_1.models['tradle.Organization'],
            signed: true
        })
    };
    yield friends.removeByIdentityPermalink(alice.link);
    yield friends.add(friendOpts);
    const friend = yield friends.getByIdentityPermalink(alice.permalink);
    t.equal(friend.name, friendOpts.name);
    t.equal(friend.url, friendOpts.url);
    t.end();
})));
//# sourceMappingURL=friends.test.js.map