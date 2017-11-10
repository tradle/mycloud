require('./env').install();
const AWS = require('aws-sdk');
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
const test = require('tape');
const co = require('../utils').loudCo;
const { aws, dbUtils: { getTable, batchPut } } = require('../').tradle;
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
test('batch put', co(function* (t) {
    let timesCalled = 0;
    const { docClient } = aws;
    aws.docClient = {
        batchWrite: function ({ RequestItems }) {
            let promise;
            timesCalled++;
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
        }
    };
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
    t.equal(timesCalled, 2);
    aws.docClient = docClient;
    t.end();
}));
//# sourceMappingURL=dynamodb.test.js.map