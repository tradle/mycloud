import fetch from 'node-fetch';
import FormData from 'form-data';

/*
const form = new FormData();

form.append('photo1','http://10.0.2.15:4572/tdl-tradle-ltd-dev-fileuploadbucket/181fbcb7853649aa482b31d18cf980a7202bf45386c4a4e2b1eceb2852ace2ab?AWSAccessKeyId=17ANCD123PSB3MHY06G2&Expires=1528246887&Signature=KXSkVuDSKdPOMAbVJ7p8hmRoyg8%3D');

form.append('photo2','http://10.0.2.15:4572/tdl-tradle-ltd-dev-fileuploadbucket/744edc67fb677775bc85d98e531b7b44838aad02cb6fac48bd28735e2f964534?AWSAccessKeyId=17ANCD123PSB3MHY06G2&Expires=1528247655&Signature=PyfHcHXB038jYOObY90gQeO0bgE%3D');

form.append("threshold", "low");


fetch('http://localhost:8000/v1/verify', { method: 'POST', body: form, headers: {'Authorization':'Token yb2e-hkPz'} })
    .then(res => res.json())
    .then(json => console.log(JSON.stringify(json, null, 2))).catch(err => console.error(err));
*/
const form1 = new FormData();

form1.append('photo1','http://localhost:4572/publicstuff/ronald-dl1.jpg');

form1.append('photo2','http://localhost:4572/publicstuff/daniel-passport1.jpg');
form1.append("threshold", "low");

fetch('http://localhost:8000/v1/verify', { method: 'POST', body: form1, headers: {'Authorization':'Token yb2e-hkPz'} })
    .then(res => res.json())
    .then(json => console.log(JSON.stringify(json, null, 2))).catch(err => console.error(err));
/*
const form2 = new FormData();

form2.append('photo1','http://localhost:4572/publicstuff/ronald-dl1.jpg');

form2.append('photo2','http://localhost:4572/publicstuff/ronald-selfie.jpg');

fetch('http://localhost:8000/v1/verify', { method: 'POST', body: form2, headers: {'Authorization':'Token yb2e-hkPz'} })
    .then(res => res.json())
    .then(json => console.log(JSON.stringify(json, null, 2))).catch(err => console.error(err)); 

const form3 = new FormData();

form3.append('photo','http://localhost:4572/publicstuff/daniel-passport1.jpg');

fetch('http://localhost:8000/v1/detect', { method: 'POST', body: form3, headers: {'Authorization':'Token yb2e-hkPz'} })
    .then(res => res.json())
    .then(json => console.log(JSON.stringify(json, null, 2))).catch(err => console.error(err));
*/



