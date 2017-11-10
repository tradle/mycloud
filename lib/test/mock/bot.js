const co = require('co').wrap;
const createBot = require('../../bot');
const fakeTradle = require('./tradle');
const fakeUsers = require('./users');
const promiseNoop = co(function* () { });
module.exports = fakeBot;
function fakeBot(opts = {}) {
    let { send = promiseNoop, objects = {}, identities = {}, messages = {}, } = opts;
    const tradle = opts.tradle || fakeTradle(opts);
    const models = {};
    const inputs = fakeBot.inputs({ models, tradle });
    inputs.users = fakeUsers({
        oncreate: user => bot.trigger('usercreate', user)
    });
    const bot = createBot(inputs);
    return bot;
}
fakeBot.inputs = createBot.inputs;
fakeBot.fromEngine = opts => fakeBot(fakeBot.inputs(opts));
//# sourceMappingURL=bot.js.map