const Blockr = require('@tradle/cb-blockr');
const Networks = require('@tradle/bitcoin-adapter');
module.exports = getNetworkAdapters;
function getNetworkAdapters({ networkName, privateKey, proxy }) {
    const network = Networks[networkName];
    const blockchain = network.wrapCommonBlockchain(new Blockr(networkName, proxy));
    const transactor = privateKey && network.createTransactor({ privateKey, blockchain });
    return {
        network,
        blockchain,
        transactor
    };
}
//# sourceMappingURL=bitcoin.js.map