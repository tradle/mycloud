export default class Identities {
  private objects;
  private pubKeys;
  constructor(opts: {
    tables: any;
    objects: any;
  });
  getIdentityMetadataByPub: (pub: any) => any;
  getIdentityByPub: (pub: any) => Promise<any>;
  getIdentityByPermalink: (permalink: string) => Promise<any>;
  getExistingIdentityMapping: (identity: any) => Promise<any>;
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
  addAuthorInfo: (object: any) => Promise<any>;
  validateAndAdd: (identity: any) => Promise<void>;
}
