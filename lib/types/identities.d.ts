export class Identities {
    private objects;
    private pubKeys;
    constructor(opts: {
        tables: any;
        objects: any;
    });
    getIdentityMetadataByPub: (pub: any) => any;
    getIdentityByPub: (pub: any) => Promise<any>;
    getIdentityByPermalink: (permalink: string) => Promise<any>;
    getExistingIdentityMapping: (identity: any) => any;
    validateNewContact: (identity: any) => Promise<{
        identity: any;
        exists: boolean;
    }>;
    addContact: (object: any) => Promise<void>;
    putPubKey: (opts: {
        link: string;
        permalink: string;
        pub: any;
    }) => any;
    /**
     * Add author metadata, including designated recipient, if object is a message
     * @param {String} object._sigPubKey author sigPubKey
     */
    addAuthorInfo: (object: any) => Promise<any>;
    validateAndAdd: (identity: any) => Promise<void>;
}
