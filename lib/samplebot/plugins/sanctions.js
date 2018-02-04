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
const fetch = require("node-fetch");
const buildResource = require("@tradle/build-resource");
const build_resource_1 = require("@tradle/build-resource");
const constants = require("@tradle/constants");
const success = {
    "code": 200,
    "status": "success",
    "content": {
        "data": {
            "id": 35058571,
            "ref": "1517629273-f6a9h7KG",
            "searcher_id": 1441,
            "assignee_id": 1441,
            "filters": {
                "types": [
                    "sanction"
                ],
                "birth_year": 2014,
                "exact_match": false,
                "fuzziness": 1
            },
            "match_status": "no_match",
            "risk_level": "unknown",
            "search_term": "Nordgregglee",
            "submitted_term": "Nordgregglee",
            "client_ref": null,
            "total_hits": 0,
            "updated_at": "2018-02-03 03:41:13",
            "created_at": "2018-02-03 03:41:13",
            "limit": 100,
            "offset": 0,
            "hits": []
        }
    }
};
const undetermined = {
    "code": 200,
    "status": "success",
    "content": {
        "data": {
            "id": 34938499,
            "ref": "1517504402-OvZRF6Cz",
            "searcher_id": 1441, "assignee_id": 1441,
            "filters": {
                "types": ["sanction"],
                "birth_year": 1970,
                "exact_match": false,
                "fuzziness": 1
            },
            "match_status": "potential_match", "risk_level": "unknown", "search_term": "  Khanani",
            "submitted_term": "Khanani", "client_ref": null,
            "total_hits": 1,
            "updated_at": "2018-02-01 17:00:02",
            "created_at": "2018-02-01 17:00:02",
            "limit": 100,
            "offset": 0,
            "hits": [
                {
                    "doc": {
                        "aka": [{ "name": "ALTAF KHANANI MONEY LAUNDERING ORGANIZATION" }],
                        "entity_type": "company",
                        "fields": [
                            { "name": "Countries", "tag": "country_names", "value": "Australia" },
                            { "name": "OFAC ID", "source": "ofac-sdn-list", "value": "OFAC-18247" },
                            { "locale": "en", "name": "Programs", "source": "ofac-sdn-list", "value": "* TCO: Transnational Criminal Organizations Sanctions Regulations, 31 C.F.R. part 590; Executive Order 13581" },
                            { "name": "Address", "source": "ofac-sdn-list", "value": "Australia" },
                            { "name": "Related URL",
                                "source": "ofac-sdn-list",
                                "tag": "related_url",
                                "value": "http:\/\/www.treasury.gov\/resource-center\/sanctions\/SDN-List\/Pages\/default.aspx"
                            }
                        ],
                        "id": "BFFHVUO8R0V5RJD",
                        "keywords": [],
                        "last_updated_utc": "2018-01-25T11:43:12Z",
                        "name": "ALTAF KHANANI MONEY LAUNDERING ORGANIZATION",
                        "sources": ["ofac-sdn-list"],
                        "types": ["sanction"]
                    },
                    "match_types": ["name_exact"],
                    "score": 1.711
                }
            ]
        }
    }
};
const { TYPE } = constants;
const VERIFICATION = 'tradle.Verification';
const BASE_URL = 'https://api.complyadvantage.com/';
const FORM_ID = 'tradle.BusinessInformation';
class ComplyAdvantageAPI {
    constructor({ bot, apiKey, productsAPI, logger }) {
        this.bot = bot;
        this.apiKey = apiKey;
        this.productsAPI = productsAPI;
        this.logger = logger;
    }
    _fetch(resource, conf, application) {
        return __awaiter(this, void 0, void 0, function* () {
            let body = {
                search_term: conf.search_term || resource.companyName,
                fuzziness: conf.fuzziness || 1,
                share_url: 1,
                filters: {
                    types: conf.types || ['sanction'],
                    birth_year: new Date(resource.registrationDate).getFullYear()
                }
            };
            body = JSON.stringify(body);
            let url = `https://api.complyadvantage.com/searches?api_key=${this.apiKey}`;
            let json;
            try {
                let res = yield fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body
                });
                json = yield res.json();
            }
            catch (err) {
                this.logger.debug('something went wrong', err);
            }
            if (!json || json.status !== 'success') {
                return;
            }
            let rawData = json && json.content.data;
            let entityType = conf.entity_type || 'company';
            let hits = rawData.hits.filter((hit) => hit.doc.entity_type === entityType);
            return hits && { resource, rawData, hits };
        });
    }
    createSanctionsCheck({ application, rawData, user }) {
        return __awaiter(this, void 0, void 0, function* () {
            let resource = {
                [TYPE]: 'tradle.SanctionsCheck',
                status: rawData.hits.length ? 'Fail' : 'Success',
                provider: 'Comply Advantage',
                reason: rawData,
                application: build_resource_1.buildResourceStub({ resource: application, models: this.bot.models }),
                dateChecked: rawData.updated_at,
                sharedUrl: rawData.share_url
            };
            if (!application.checks)
                application.checks = [];
            const check = yield this.bot.signAndSave(resource);
            application.checks.push(build_resource_1.buildResourceStub({ resource: check, models: this.bot.models }));
        });
    }
    createVerification({ user, application, form, rawData }) {
        return __awaiter(this, void 0, void 0, function* () {
            const method = {
                [TYPE]: 'tradle.APIBasedVerificationMethod',
                api: {
                    [TYPE]: 'tradle.API',
                    name: 'complyadvantage'
                },
                aspect: 'sanctions check',
                reference: [{ queryId: 'report:' + rawData.id }],
                rawData: rawData
            };
            let verification = buildResource({
                models: this.bot.models,
                model: VERIFICATION
            })
                .set({
                document: form,
                method
            })
                .toJSON();
            const signedVerification = yield this.bot.signAndSave(verification);
            this.productsAPI.importVerification({ user, application, verification: signedVerification });
        });
    }
}
function createPlugin({ conf, bot, productsAPI, logger }) {
    const complyAdvantage = new ComplyAdvantageAPI({ bot, apiKey: conf.apiKey, productsAPI, logger });
    return {
        [`onmessage:${FORM_ID}`]: function (req) {
            return __awaiter(this, void 0, void 0, function* () {
                debugger;
                const { user, application, applicant, payload } = req;
                let productId = application.requestFor;
                if (!conf[productId] || !conf[productId][FORM_ID])
                    return;
                let forms = [payload];
                let pforms = forms.map((f) => complyAdvantage._fetch(f, conf[application.requestFor][FORM_ID], application));
                let result = yield Promise.all(pforms);
                let pchecks = result.map((r) => {
                    let { resource, rawData, hits } = r;
                    if (hits && hits.length) {
                        logger.debug(`found sanctions for: ${resource.companyName}`);
                        return complyAdvantage.createSanctionsCheck({ application, user, rawData: rawData });
                    }
                    else {
                        logger.debug(`creating verification for: ${resource.companyName}`);
                        return complyAdvantage.createVerification({ user, application, form: resource, rawData });
                    }
                });
                let checksAndVerifications = yield Promise.all(pchecks);
            });
        }
    };
}
exports.createPlugin = createPlugin;
//# sourceMappingURL=sanctions.js.map