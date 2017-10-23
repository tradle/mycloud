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
const db_utils_1 = require("./db-utils");
const utils_1 = require("./utils");
const string_utils_1 = require("./string-utils");
const crypto_1 = require("./crypto");
const Errors = require("./errors");
const types = require("./typeforce-types");
const constants = require("./constants");
const { HANDSHAKE_TIMEOUT } = constants;
const { HandshakeFailed, InvalidInput, NotFound } = Errors;
class Auth {
    constructor(opts) {
        this.onAuthenticated = (session) => __awaiter(this, void 0, void 0, function* () {
            session = Object.assign({}, session, { authenticated: true });
            this.debug('saving session', string_utils_1.prettify(session));
            yield this.tables.Presence.put({ Item: session });
        });
        this.updatePresence = (opts) => {
            const { clientId, connected } = opts;
            const params = db_utils_1.getUpdateParams({ connected });
            params.Key = getKeyFromClientId(clientId);
            return this.tables.Presence.update(params);
        };
        this.deleteSession = (clientId) => {
            const Key = getKeyFromClientId(clientId);
            return this.tables.Presence.del({ Key });
        };
        this.deleteSessionsByPermalink = (permalink) => {
            return this.tables.Presence.del(getSessionsByPermalinkQuery);
        };
        this.getSessionsByPermalink = (permalink) => {
            return this.tables.Presence.find(getSessionsByPermalinkQuery(permalink));
        };
        this.getLiveSessionByPermalink = (permalink) => __awaiter(this, void 0, void 0, function* () {
            const sessions = yield this.getSessionsByPermalink(permalink);
            const latest = sessions
                .filter(session => session.authenticated && session.connected)
                .sort((a, b) => {
                return a.time - b.time;
            })
                .pop();
            if (!latest) {
                throw new NotFound('no authenticated sessions found');
            }
            this.debug('latest authenticated session:', string_utils_1.prettify(latest));
            return latest;
        });
        this.getSession = (opts) => {
            const { clientId } = opts;
            return this.tables.Presence.findOne({
                KeyConditionExpression: 'permalink = :permalink AND clientId = :clientId',
                ExpressionAttributeValues: {
                    ':clientId': clientId,
                    ':permalink': getPermalinkFromClientId(clientId),
                }
            });
        };
        this.createChallenge = (opts) => __awaiter(this, void 0, void 0, function* () {
            const { clientId, permalink } = opts;
            const challenge = crypto_1.randomString(32);
            const Item = {
                clientId,
                permalink,
                challenge,
                time: Date.now(),
                authenticated: false,
                connected: false
            };
            yield this.tables.Presence.put({ Item });
            return challenge;
        });
        this.handleChallengeResponse = (response) => __awaiter(this, void 0, void 0, function* () {
            try {
                utils_1.typeforce({
                    clientId: utils_1.typeforce.String,
                    permalink: utils_1.typeforce.String,
                    challenge: utils_1.typeforce.String,
                    position: types.position
                }, response);
            }
            catch (err) {
                this.debug('received invalid input', err.stack);
                throw new InvalidInput(err.message);
            }
            const { clientId, permalink, challenge, position } = response;
            const session = yield this.tables.Presence.get({
                Key: { clientId, permalink }
            });
            if (challenge !== session.challenge) {
                throw new HandshakeFailed('stored challenge does not match response');
            }
            if (permalink !== session.permalink) {
                throw new HandshakeFailed('claimed permalink changed from preauth');
            }
            if (Date.now() - session.time > HANDSHAKE_TIMEOUT) {
                throw new HandshakeFailed('handshake timed out');
            }
            this.objects.addMetadata(response);
            yield this.identities.addAuthorInfo(response);
            if (response._author !== permalink) {
                throw new HandshakeFailed('signature does not match claimed identity');
            }
            const getLastSent = this.messages.getLastMessageTo({ recipient: permalink, body: false })
                .then(message => this.messages.getMessageStub({ message }))
                .catch(err => {
                if (err instanceof NotFound)
                    return null;
                throw err;
            });
            session.clientPosition = position;
            session.serverPosition = {
                sent: yield getLastSent
            };
            yield this.onAuthenticated(session);
            return session;
        });
        this.getTemporaryIdentity = (opts) => __awaiter(this, void 0, void 0, function* () {
            try {
                utils_1.typeforce({
                    accountId: utils_1.typeforce.String,
                    clientId: utils_1.typeforce.String,
                    identity: types.identity
                }, opts);
            }
            catch (err) {
                this.debug('received invalid input', err.stack);
                throw new InvalidInput(err.message);
            }
            const { accountId, clientId, identity } = opts;
            const permalink = crypto_1.getPermalink(identity);
            if (permalink !== getPermalinkFromClientId(clientId)) {
                throw new InvalidInput('expected "clientId" to have format {permalink}{nonce}');
            }
            const maybeAddContact = this.identities.validateAndAdd(identity);
            const role = `arn:aws:iam::${accountId}:role/${this.resources.Role.IotClient}`;
            this.debug(`generating temp keys for client ${clientId}, role ${role}`);
            this.debug('assuming role', role);
            const params = {
                RoleArn: role,
                RoleSessionName: crypto_1.randomString(16),
            };
            const [challenge] = yield Promise.all([
                this.createChallenge({ clientId, permalink }),
                maybeAddContact
            ]);
            const { AssumedRoleUser, Credentials } = yield this.aws.sts.assumeRole(params).promise();
            this.debug('assumed role', role);
            const resp = {
                iotEndpoint: yield this.iot.getEndpoint(),
                iotParentTopic: this.env.IOT_PARENT_TOPIC,
                region: this.env.AWS_REGION,
                accessKey: Credentials.AccessKeyId,
                secretKey: Credentials.SecretAccessKey,
                sessionToken: Credentials.SessionToken,
                uploadPrefix: this.getUploadPrefix(AssumedRoleUser),
                time: Date.now(),
                challenge
            };
            if (this.env.IS_OFFLINE) {
                resp.s3Endpoint = this.aws.s3.endpoint.host;
            }
            return resp;
        });
        this.getUploadPrefix = (AssumedRoleUser) => {
            return `${this.resources.Bucket.FileUpload}/${AssumedRoleUser.AssumedRoleId}/`;
        };
        this.getMostRecentSessionByClientId = (clientId) => {
            return this.getLiveSessionByPermalink(getPermalinkFromClientId(clientId));
        };
        [
            'env', 'aws', 'resources', 'tables',
            'identities', 'objects', 'messages', 'iot'
        ].forEach(prop => utils_1.defineGetter(this, prop, () => opts[prop]));
        this.debug = this.env.logger('auth');
    }
}
exports.default = Auth;
function getPermalinkFromClientId(clientId) {
    return clientId.slice(0, 64);
}
function getKeyFromClientId(clientId) {
    return {
        clientId,
        permalink: getPermalinkFromClientId(clientId)
    };
}
function getSessionsByPermalinkQuery(permalink) {
    return {
        KeyConditionExpression: 'permalink = :permalink AND begins_with(clientId, :permalink)',
        ExpressionAttributeValues: {
            ':permalink': permalink
        }
    };
}
//# sourceMappingURL=auth.js.map