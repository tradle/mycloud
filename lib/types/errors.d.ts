export type Errors = {
    export: (err: Error) => {
        type: string;
        message: string;
    };
    isDeveloperError: (err: Error) => boolean;
    isCustomError: (err: Error) => boolean;
    is: (err: Error, errType: any) => boolean;
    NotFound: ErrorConstructor;
    InvalidSignature: ErrorConstructor;
    InvalidMessageFormat: ErrorConstructor;
    PutFailed: ErrorConstructor;
    MessageNotForMe: ErrorConstructor;
    HandshakeFailed: ErrorConstructor;
    LambdaInvalidInvocation: ErrorConstructor;
    InvalidInput: ErrorConstructor;
    ClockDrift: ErrorConstructor;
    BatchPutFailed: ErrorConstructor;
    Duplicate: ErrorConstructor;
    TimeTravel: ErrorConstructor;
};
