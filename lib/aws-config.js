"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createConfig = ({ env }) => {
    const { TESTING } = env;
    const services = {
        maxRetries: 6,
        region: process.env.AWS_REGION || 'us-east-1'
    };
    if (TESTING) {
        const localstack = require('../test/localstack');
        for (let name in localstack) {
            let lname = name.toLowerCase();
            if (!services[lname])
                services[lname] = {};
            services[lname].endpoint = localstack[name];
        }
        services.s3.s3ForcePathStyle = true;
    }
    return services;
};
//# sourceMappingURL=aws-config.js.map