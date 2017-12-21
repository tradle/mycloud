"use strict";
const debug = require('debug')('tradle:sls:faucet');
const Spender = require('@tradle/spender');
const Blockchain = require('@tradle/cb-blockr');
const { co, promisify, typeforce } = require('./utils');
const types = require('./typeforce-types');
const addressAmount = typeforce.compile({
    address: types.address.bitcoin,
    amount: types.amount.bitcoin
});
module.exports = function createFaucet({ privateKey, networkName }) {
    const blockchain = new Blockchain(networkName);
    const withdraw = co(function* ({ to, fee }) {
        const spender = new Spender(networkName)
            .blockchain(blockchain)
            .from(privateKey);
        if (typeof fee !== 'undefined') {
            spender.fee(fee);
        }
        to.forEach(item => {
            typeforce(addressAmount, item);
            const { address, amount } = item;
            debug(`sending ${amount} to ${address}`);
            spender.to(address, amount);
        });
        if (to.length < 3) {
            spender.to(spender.key.pub.getAddress(spender.network).toString(), 100000);
        }
        let tx;
        try {
            tx = yield promisify(spender.execute)();
        }
        catch (err) {
            debug('failed to distribute funds from faucet', err);
            throw err;
        }
        return {
            txId: tx.getId()
        };
    });
    return {
        withdraw
    };
};
//# sourceMappingURL=faucet-bitcoin.js.map