module.exports = bot => {
    ;
    ['message', 'readseal', 'wroteseal'].forEach(event => {
        bot[`on${event}`] = fn => bot.hook(event, fn);
    });
};
//# sourceMappingURL=backwards-compat.js.map