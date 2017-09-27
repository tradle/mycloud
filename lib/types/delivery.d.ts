import { EventEmitter } from 'events';
export class Delivery extends EventEmitter {
    mqtt: any;
    http: any;
    friends: any;
    messages: any;
    constructor(opts: any);
    deliverBatch: (opts: any) => Promise<any>;
    ack: (opts: any) => Promise<any>;
    reject: (opts: any) => Promise<any>;
    deliverMessages(opts: any): Promise<void>;
    getTransport(opts: {
        method: string;
        recipient: string;
        clientId?: string;
        friend?: any;
    }): Promise<any>;
}
