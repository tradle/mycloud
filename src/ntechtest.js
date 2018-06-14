"use strict";
exports.__esModule = true;
var node_fetch_1 = require("node-fetch");
var form_data_1 = require("form-data");
var form = new form_data_1["default"]();
form.append('photo1', 'http://10.0.2.15:4572/tdl-tradle-ltd-dev-fileuploadbucket/181fbcb7853649aa482b31d18cf980a7202bf45386c4a4e2b1eceb2852ace2ab?AWSAccessKeyId=17ANCD123PSB3MHY06G2&Expires=1528246887&Signature=KXSkVuDSKdPOMAbVJ7p8hmRoyg8%3D');
form.append('photo2', 'http://10.0.2.15:4572/tdl-tradle-ltd-dev-fileuploadbucket/744edc67fb677775bc85d98e531b7b44838aad02cb6fac48bd28735e2f964534?AWSAccessKeyId=17ANCD123PSB3MHY06G2&Expires=1528247655&Signature=PyfHcHXB038jYOObY90gQeO0bgE%3D');
node_fetch_1["default"]('http://localhost:8000/v1/verify', { method: 'POST', body: form, headers: { 'Authorization': 'Token yb2e-hkPz' } })
    .then(function (res) { return res.json(); })
    .then(function (json) { return console.log(json); })["catch"](function (err) { return console.error(err); });
