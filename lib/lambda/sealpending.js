process.env.LAMBDA_BIRTH_DATE = Date.now();
const { wrap, seals, debug } = require('../').createTradle();
exports.handler = wrap(function () {
    debug('[START]', Date.now());
    return seals.sealPending();
});
//# sourceMappingURL=sealpending.js.map