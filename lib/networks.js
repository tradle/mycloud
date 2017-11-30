"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const curve = 'secp256k1';
const networks = {
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
module.exports = {};
const getAdapter = name => {
    const adapters = require('./blockchain-adapter').default;
    return adapters[name];
};
Object.keys(networks).forEach(flavor => {
    const sub = module.exports[flavor] = {};
    Object.keys(networks[flavor]).forEach(networkName => {
        let readOnlyAdapter;
        let cached;
        Object.defineProperty(sub, networkName, {
            enumerable: true,
            get() {
                if (!cached) {
                    cached = Object.assign({}, networks[flavor][networkName], { flavor,
                        networkName,
                        curve,
                        get constants() {
                            if (!readOnlyAdapter) {
                                readOnlyAdapter = getReadOnlyAdapter();
                            }
                            return readOnlyAdapter.constants;
                        }, readOnlyAdapter: getReadOnlyAdapter, transactor: function (privateKey) {
                            return getAdapter(flavor)({ networkName, privateKey }).transactor;
                        }, toString: () => `${flavor}:${networkName}`, select: obj => obj[flavor] });
                }
                return cached;
            }
        });
        function getReadOnlyAdapter(opts = {}) {
            if (!readOnlyAdapter) {
                opts.networkName = networkName;
                readOnlyAdapter = getAdapter(flavor)(opts);
            }
            return readOnlyAdapter;
        }
    });
});
//# sourceMappingURL=networks.js.map