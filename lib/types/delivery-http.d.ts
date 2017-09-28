import { EventEmitter } from 'events';
export class DeliveryHTTP extends EventEmitter {
    constructor(opts: any);
    deliverBatch: (opts: any) => Promise<any>;
    ack: (opts: any) => Promise<any>;
    reject: (opts: any) => Promise<any>;
}
