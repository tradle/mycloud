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
const crypto_1 = require("./crypto");
const Errors = require("./errors");
const types = require("./typeforce-types");
const constants = require("./constants");
const { HANDSHAKE_TIMEOUT } = constants;
const { HandshakeFailed, InvalidInput, NotFound } = Errors;
class Auth {
    constructor(opts) {
        this.getPermalinkFromClientId = getPermalinkFromClientId;
        this.putSession = (session) => __awaiter(this, void 0, void 0, function* () {
            this.logger.debug('saving session', session);
            return yield this.tables.Presence.put({
                Item: session
            });
        });
        this.setConnected = ({ clientId, connected }) => __awaiter(this, void 0, void 0, function* () {
            if (!connected) {
                return yield this.updateSession({ clientId }, { connected: false, subscribed: false });
            }
            return yield this.tables.Presence.update({
                Key: getKeyFromClientId(clientId),
                UpdateExpression: 'SET #connected = :connected',
                ConditionExpression: '#authenticated = :authenticated',
                ExpressionAttributeNames: {
                    '#connected': 'connected',
                    '#authenticated': 'authenticated'
                },
                ExpressionAttributeValues: {
                    ':connected': true,
                    ':authenticated': true
                },
                ReturnValues: 'ALL_NEW'
            });
        });
        this.setSubscribed = ({ clientId, subscribed }) => __awaiter(this, void 0, void 0, function* () {
            if (!subscribed) {
                return yield this.updateSession({ clientId }, { subscribed: false });
            }
            return yield this.tables.Presence.update({
                Key: getKeyFromClientId(clientId),
                UpdateExpression: 'SET #subscribed = :subscribed',
                ConditionExpression: '#authenticated = :authenticated',
                ExpressionAttributeNames: {
                    '#subscribed': 'subscribed',
                    '#authenticated': 'authenticated'
                },
                ExpressionAttributeValues: {
                    ':subscribed': true,
                    ':authenticated': true
                },
                ReturnValues: 'ALL_NEW'
            });
        });
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
            this.logger.debug('latest authenticated session', latest);
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
        this.createChallenge = () => crypto_1.randomString(32);
        this.handleChallengeResponse = (challengeResponse) => __awaiter(this, void 0, void 0, function* () {
            try {
                utils_1.typeforce({
                    clientId: utils_1.typeforce.String,
                    permalink: utils_1.typeforce.String,
                    challenge: utils_1.typeforce.String,
                    position: types.position
                }, challengeResponse);
            }
            catch (err) {
                this.logger.error('received invalid input', err.stack);
                throw new InvalidInput(err.message);
            }
            const { clientId, permalink, challenge, position } = challengeResponse;
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
            this.objects.addMetadata(challengeResponse);
            yield this.identities.addAuthorInfo(challengeResponse);
            if (challengeResponse._author !== permalink) {
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
            session.authenticated = true;
            this.tasks.add({
                name: 'savesession',
                promise: this.putSession(session)
            });
            return session;
        });
        this.createCredentials = (session, role) => __awaiter(this, void 0, void 0, function* () {
            const { clientId } = session;
            if (!role.startsWith('arn:')) {
                role = `arn:aws:iam::${this.accountId}:role/${role}`;
            }
            this.logger.debug(`generating temp keys for client ${clientId}, role ${role}`);
            this.logger.info('assuming role', role);
            const params = {
                RoleArn: role,
                RoleSessionName: crypto_1.randomString(16),
            };
            const promiseRole = this.aws.sts.assumeRole(params).promise();
            const { AssumedRoleUser, Credentials } = yield promiseRole;
            this.logger.debug('assumed role', role);
            return {
                accessKey: Credentials.AccessKeyId,
                secretKey: Credentials.SecretAccessKey,
                sessionToken: Credentials.SessionToken,
                uploadPrefix: this.getUploadPrefix(AssumedRoleUser)
            };
        });
        this.createSession = (opts) => __awaiter(this, void 0, void 0, function* () {
            try {
                utils_1.typeforce({
                    clientId: utils_1.typeforce.String,
                    identity: types.identity
                }, opts);
            }
            catch (err) {
                this.logger.error('received invalid input', { input: opts, stack: err.stack });
                throw new InvalidInput(err.message);
            }
            const { clientId, identity } = opts;
            const permalink = crypto_1.getPermalink(identity);
            if (permalink !== getPermalinkFromClientId(clientId)) {
                throw new InvalidInput('expected "clientId" to have format {permalink}{nonce}');
            }
            const maybeAddContact = this.identities.addContact(identity);
            const challenge = this.createChallenge();
            const getIotEndpoint = this.iot.getEndpoint();
            const saveSession = this.tables.Presence.put({
                Item: {
                    clientId,
                    permalink,
                    challenge,
                    time: Date.now(),
                    authenticated: false,
                    connected: false
                }
            });
            yield Promise.all([
                saveSession,
                maybeAddContact
            ]);
            const resp = {
                iotEndpoint: yield getIotEndpoint,
                iotParentTopic: this.env.IOT_PARENT_TOPIC,
                region: this.env.AWS_REGION,
                time: Date.now(),
                challenge
            };
            if (this.env.IS_OFFLINE) {
                resp.s3Endpoint = this.aws.s3.endpoint.host;
            }
            return resp;
        });
        this.getUploadPrefix = (AssumedRoleUser) => {
            return `${this.serviceMap.Bucket.FileUpload}/${AssumedRoleUser.AssumedRoleId}/`;
        };
        this.getMostRecentSessionByClientId = (clientId) => {
            return this.getLiveSessionByPermalink(getPermalinkFromClientId(clientId));
        };
        this.updateSession = ({ clientId }, update) => __awaiter(this, void 0, void 0, function* () {
            return yield this.tables.Presence.update(Object.assign({ Key: getKeyFromClientId(clientId), ReturnValues: 'ALL_NEW' }, db_utils_1.getUpdateParams(update)));
        });
        this.env = opts.env;
        this.aws = opts.aws;
        this.serviceMap = opts.serviceMap;
        this.tables = opts.tables;
        this.identities = opts.identities;
        this.objects = opts.objects;
        this.messages = opts.messages;
        this.iot = opts.iot;
        this.logger = opts.logger.sub('auth');
        this.tasks = opts.tasks;
    }
    get accountId() {
        return this.env.accountId;
    }
}
Auth.getPermalinkFromClientId = getPermalinkFromClientId;
exports.default = Auth;
function getKeyFromClientId(clientId) {
    return {
        clientId,
        permalink: getPermalinkFromClientId(clientId)
    };
}
function getPermalinkFromClientId(clientId) {
    return clientId.slice(0, 64);
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