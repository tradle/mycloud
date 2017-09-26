import { Session } from './';
import { Identities } from './identities'
export class Auth {
    constructor(opts: {
        env: any;
        aws: any;
        resources: any;
        tables: any;
        identities: Identities;
        objects: any;
        messages: any;
    });
    onAuthenticated: (session: Session) => Promise<void>;
    updatePresence: (opts: {
        clientId: string;
        connected: boolean;
    }) => Promise<any>;
    deleteSession: (clientId: string) => Promise<any>;
    deleteSessionsByPermalink: (permalink: string) => Promise<any>;
    getSessionsByPermalink: (permalink: string) => Promise<any>;
    getLiveSessionByPermalink: (permalink: string) => Promise<any>;
    getSession: (opts: {
        clientId: string;
    }) => Promise<any>;
    createChallenge: (opts: {
        clientId: string;
        permalink: string;
    }) => Promise<string>;
    handleChallengeResponse: (response: {
        clientId: string;
        permalink: string;
        challenge: string;
        position: any;
    }) => Promise<Session>;
    getTemporaryIdentity: (opts: {
        accountId: string;
        clientId: string;
        identity: string;
    }) => Promise<any>;
    getUploadPrefix: (AssumedRoleUser: {
        AssumedRoleId: string;
    }) => string;
    getMostRecentSessionByClientId: (clientId: any) => Promise<any>;
}
