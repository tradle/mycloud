#!/usr/bin/env node
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
require('../test/env').install();
const fs = require("fs");
const mkdirp = require("mkdirp");
const promisify = require("pify");
const engine_1 = require("@tradle/engine");
const crypto_1 = require("../crypto");
const crypto_2 = require("../crypto");
const utils_1 = require("../test/utils");
const utils_2 = require("../utils");
const helpers = require('@tradle/engine/test/helpers');
const networks = require('../networks');
const identityOpts = crypto_2.getIdentitySpecs({ networks });
const genUser = promisify(engine_1.utils.newIdentity);
const genUsers = n => new Array(n).fill(0).map(() => {
    return genUser(identityOpts)
        .then(user => {
        user.profile = utils_1.createTestProfile();
        return user;
    });
});
(() => __awaiter(this, void 0, void 0, function* () {
    const users = yield genUsers(10);
    users.forEach(user => {
        user.keys = crypto_1.exportKeys(user.keys.map(key => {
            return engine_1.utils.importKey(key);
        }));
    });
    fs.writeFileSync(`./test/fixtures/users-pem.json`, prettify(users));
}))();
(() => __awaiter(this, void 0, void 0, function* () {
    const users = yield genUsers(2);
    const friends = users
        .map((user, i) => helpers.userToOpts(user, i ? 'alice' : 'bob'))
        .map(helpers.createNode)
        .map(node => engine_1.utils.promisifyNode(node));
    yield promisify(helpers.meet)(friends);
    const [alice, bob] = friends;
    helpers.connect(friends);
    const eachToGet = 2;
    let togo = eachToGet * 2;
    let firstTimestamp = Date.now();
    const received = {};
    friends.forEach(node => {
        received[node.name] = [];
        mkdirp.sync(`./test/fixtures/${node.name}`);
        fs.writeFileSync(`./test/fixtures/${node.name}/identity.json`, prettify(node.identityInfo.object));
        fs.writeFileSync(`./test/fixtures/${node.name}/object.json`, prettify({
            object: node.identityInfo.object,
            link: node.link,
            permalink: node.permalink
        }));
        fs.writeFileSync(`./test/fixtures/${node.name}/keys.json`, prettify(crypto_1.exportKeys(node.keys)));
        node.on('message', function ({ object, author, permalink, link, objectinfo }) {
            utils_2.setVirtual(object.object, {
                _author: objectinfo.author,
                _permalink: objectinfo.permalink,
                _link: objectinfo.link,
                _time: object.time
            });
            utils_2.setVirtual(object, {
                _author: author,
                _permalink: permalink,
                _link: link,
                _time: object.time
            });
            received[node.name].push(object);
            if (--togo)
                return;
            friends.forEach(node => {
                fs.writeFileSync(`./test/fixtures/${node.name}/receive.json`, prettify(received[node.name]));
                node.destroy(rethrow);
            });
        });
    });
    new Array(eachToGet).fill(0).forEach((n, i) => {
        helpers.eachOther(friends, function (a, b, done) {
            a.signAndSend({
                to: b._recipientOpts,
                object: {
                    _t: 'tradle.SimpleMessage',
                    message: `${i}. hey ${b.name}!`
                },
                time: nextTimestamp()
            }, done);
        }, rethrow);
    });
    function nextTimestamp() {
        return firstTimestamp++;
    }
}))()
    .catch(err => {
    console.error(err);
    process.exit(1);
});
function prettify(object) {
    return JSON.stringify(object, null, 2);
}
function rethrow(err) {
    if (err)
        throw err;
}
//# sourceMappingURL=gen-fixtures.js.map