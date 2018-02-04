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
require('./env').install();
const sinon = require("sinon");
const AWS = require("aws-sdk");
AWS.config.update({
    maxRetries: 0,
    retryDelayOptions: {
        customBackoff: function (retryCount) {
            console.log("AWS SERVICE RETRY COUNT", retryCount);
            if (retryCount > 3) {
                console.warn(`are you sure localstack is up? To start it, run: npm run localstack:start`);
            }
            return Math.pow(2, retryCount) * 100;
        }
    }
});
const test = require("tape");
const _1 = require("../");
const utils_1 = require("../utils");
const { aws, dbUtils: { getTable, batchPut } } = _1.createTestTradle();
const schema = {
    "AttributeDefinitions": [
        {
            "AttributeName": "id",
            "AttributeType": "S"
        }
    ],
    "KeySchema": [
        {
            "AttributeName": "id",
            "KeyType": "HASH"
        }
    ],
    "ProvisionedThroughput": {
        "ReadCapacityUnits": 1,
        "WriteCapacityUnits": 1
    },
    "StreamSpecification": {
        "StreamEnabled": true,
        "StreamViewType": "NEW_AND_OLD_IMAGES"
    },
    "TableName": "TestTable"
};
test('batch put', utils_1.loudAsync((t) => __awaiter(this, void 0, void 0, function* () {
    const { docClient } = aws;
    const stub = sinon.stub(aws.docClient, 'batchWrite').callsFake(({ RequestItems }) => {
        let promise;
        for (let TableName in RequestItems) {
            const items = RequestItems[TableName];
            if (items.length > 15) {
                promise = Promise.resolve({
                    UnprocessedItems: {
                        [TableName]: items.slice(15)
                    }
                });
            }
            else {
                promise = Promise.resolve({});
            }
            break;
        }
        return {
            promise: () => promise
        };
    });
    const batch = {
        RequestItems: {
            SomeTable: new Array(25).fill(null).map((ignore, i) => {
                return {
                    id: `${i}`
                };
            })
        }
    };
    yield batchPut(batch);
    t.equal(stub.callCount, 2);
    stub.restore();
    t.end();
})));
//# sourceMappingURL=dynamodb.test.js.map