const parseURL = require('url').parse
const formatURL = require('url').format
const co = require('co').wrap
// const Jimp = promisify(require('jimp'))
const promisify = require('pify')
const DataURI = require('datauri')
const request = require('superagent')
const getFaviconURL = promisify(require('favicon'))
const getFavicon = co(function* (siteURL) {
  let faviconURL = yield getFaviconURL(siteURL)
  faviconURL = getAbsoluteURL(siteURL, faviconURL)
  const { ok, body, text } = yield request(faviconURL)
    .set('Accept', 'application/octet-stream')

  if (!ok) {
    throw new Error(text)
  }

  return {
    url: faviconURL,
    image: body
  }
})

// const getDataURI = co(function* (url) {
//   if (/^\".*\"$/.test(url)) {
//     url = url.slice(1, url.length - 1)
//   }

//   if (/^data:/.test(url)) return url

//   const image = yield Jimp.read(url)
//   const width = image.bitmap.width
//   const height = image.bitmap.height
//   const biggest = Math.max(width, height)
//   const scale = (100 / biggest).toFixed(2)
//   image.scale(Number(scale))
//   const buf = yield promisify(image.getBuffer.bind(image))(Jimp.MIME_PNG)
//   const dataURI = new DataURI()
//   dataURI.format('.png', buf)
//   return dataURI.content
// })

function getAbsoluteURL (base, url) {
  if (url.startsWith('//')) {
    return 'http:' + url
  }

  if (!/^https?:\/\//.test(url)) {
    return base.replace(/[/]*$/, '') + '/' + url.replace(/^[/]*/, '')
  }

  return url
}

function normalizeURL (domain) {
  if (domain.startsWith('//')) {
    return 'http:' + domain
  }

  if (!/^https?:\/\//.test(domain)) {
    return 'http://' + domain
  }

  return domain
}

const getLogoDataURI = co(function* (domain) {
  const {
    url,
    image
  } = yield getFavicon(normalizeURL(domain))

  const ext = url.split('.').pop()
  const uri = new DataURI()
  uri.format(`.${ext}`, image)
  return uri.content
})

module.exports = {
  getLogoDataURI
}
