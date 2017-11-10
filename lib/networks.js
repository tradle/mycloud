const extend = require('xtend/mutable');
const adapters = require('./blockchain-adapter');
const curve = 'secp256k1';
const networks = module.exports = {
    bitcoin: {
        testnet: {
            minBalance: 1000000,
            confirmations: 6
        },
        bitcoin: {
            minBalance: 1000000,
            confirmations: 6
        }
    },
    ethereum: {
        rinkeby: {
            minBalance: '2000000000000000000',
            confirmations: 12
        }
    }
};
Object.keys(networks).forEach(flavor => {
    Object.keys(networks[flavor]).forEach(networkName => {
        let readOnlyAdapter;
        extend(networks[flavor][networkName], {
            flavor,
            networkName,
            curve,
            get constants() {
                if (!readOnlyAdapter) {
                    readOnlyAdapter = getReadOnlyAdapter();
                }
                return readOnlyAdapter.constants;
            },
            readOnlyAdapter: getReadOnlyAdapter,
            transactor: function (privateKey) {
                return adapters[flavor]({ networkName, privateKey }).transactor;
            },
            toString: () => `${flavor}:${networkName}`,
            select: obj => obj[flavor]
        });
        function getReadOnlyAdapter(opts = {}) {
            if (!readOnlyAdapter) {
                opts.networkName = networkName;
                readOnlyAdapter = adapters[flavor](opts);
            }
            return readOnlyAdapter;
        }
    });
});
//# sourceMappingURL=networks.js.map