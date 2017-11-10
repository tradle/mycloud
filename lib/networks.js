"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const extend = require("xtend/mutable");
const blockchain_adapter_1 = require("./blockchain-adapter");
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
                return blockchain_adapter_1.default[flavor]({ networkName, privateKey }).transactor;
            },
            toString: () => `${flavor}:${networkName}`,
            select: obj => obj[flavor]
        });
        function getReadOnlyAdapter(opts = {}) {
            if (!readOnlyAdapter) {
                opts.networkName = networkName;
                readOnlyAdapter = blockchain_adapter_1.default[flavor](opts);
            }
            return readOnlyAdapter;
        }
    });
});
//# sourceMappingURL=networks.js.map