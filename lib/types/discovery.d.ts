export class Discovery {
    private env;
    private aws;
    private lambdaUtils;
    private iot;
    constructor(opts: {
        env: any;
        aws: any;
        lambdaUtils: any;
        iot: any;
    });
    readonly thisFunctionName: any;
    updateEnvironment: (opts: {
        functionName: string;
        current?: any;
        update: any;
    }) => Promise<void>;
    getServiceDiscoveryFunctionName: () => any;
    discoverServices: (StackName: string) => Promise<any>;
    doDiscoverServices: (StackName: any) => Promise<{
        IOT_ENDPOINT: any;
    }>;
    saveToLocalFS: (vars: any) => Promise<void>;
}
