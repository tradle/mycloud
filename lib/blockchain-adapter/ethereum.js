"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const Wallet = require("ethereumjs-wallet");
const BN = require("bn.js");
const promisify = require("pify");
const fetch = require("node-fetch");
const Network = require("@tradle/ethereum-adapter");
const utils_1 = require("../utils");
const debug = require('debug')('tradle:sls:ethereum-adapter');
const FAUCET_BASE_URL = 'http://faucet.ropsten.be:3001/donate';
module.exports = function getNetworkAdapters({ networkName = 'ropsten', privateKey }) {
    let wallet;
    let transactor;
    if (privateKey) {
        privateKey = new Buffer(privateKey, 'hex');
        wallet = Wallet.fromPrivateKey(privateKey);
    }
    const network = Network.createNetwork({ networkName });
    const engine = Network.createEngine({
        networkName,
        privateKey,
        pollingInterval: 10000,
        etherscan: true,
        autostart: false
    });
    if (wallet) {
        transactor = Network.createTransactor({ network, wallet, engine });
    }
    const blockchain = Network.createBlockchainAPI({ engine });
    const getBalance = promisify(blockchain.addresses.balance);
    const recharge = ({ address, minBalance, force }) => __awaiter(this, void 0, void 0, function* () {
        const minBalanceBN = minBalance.startsWith('0x')
            ? new BN(minBalance.slice(2), 16)
            : new BN(minBalance);
        if (!force) {
            let balance;
            blockchain.start();
            try {
                balance = yield getBalance(address);
                debug(`current balance: ${balance}, min balance: ${minBalance}`);
            }
            finally {
                blockchain.stop();
            }
            if (new BN(balance).cmp(minBalanceBN) === 1) {
                debug('min balance achieved, not recharging');
                return {
                    balance
                };
            }
        }
        debug(`recharging ${address} from faucet at ${FAUCET_BASE_URL}`);
        const res = yield fetch(`${FAUCET_BASE_URL}/${address}`);
        return yield utils_1.processResponse(res);
    });
    return {
        network,
        blockchain,
        transactor,
        recharge
    };
};
//# sourceMappingURL=ethereum.js.map