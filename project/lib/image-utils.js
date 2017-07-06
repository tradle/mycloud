const parseURL = require('url').parse
const formatURL = require('url').format
const co = require('co').wrap
// const Jimp = promisify(require('jimp'))
const promisify = require('pify')
const DataURI = require('datauri')
const request = require('superagent')
const { fetchFavicon } = require('@meltwater/fetch-favicon')
const { domainToUrl } = require('./utils')
const getFaviconURL = co(function* (siteURL) {
  const icon = yield fetchFavicon(siteURL)
  return getAbsoluteURL(siteURL, icon)
})

const getFavicon = co(function* (siteURL) {
  const faviconURL = yield getFaviconURL(siteURL)
  return {
    url: faviconURL,
    image: yield downloadImage(faviconURL)
  }
})

const downloadImage = co(function* (url) {
  const { ok, body, text, header } = yield request(url)
    .set('Accept', 'application/octet-stream')

  if (!ok) {
    throw new Error(text)
  }

  return {
    type: header['content-type'],
    data: body
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
    // trim leading and trailing slash, join
    url = base.replace(/[/]*$/, '') + '/' + url.replace(/^[/]*/, '')
    if (!/https?:\/\//.test(url)) {
      url = 'http://' + url
    }
  }

  return url
}

const getDataURI = co(function* (image, ext) {
  // const ext = url.split('.').pop()
  const uri = new DataURI()
  uri.format(`.${ext}`, image)
  return uri.content
})

const getLogo = co(function* ({ logo, domain }) {
  if (!logo) {
    logo = yield getFaviconURL(domainToUrl(domain))
  }

  if (!/^data:image/.test(logo)) {
    const ext = logo.slice(logo.lastIndexOf('.'))
    const { data, type } = yield downloadImage(logo)
    logo = yield getDataURI(data, ext)
  }

  return logo
})

module.exports = {
  getDataURI,
  downloadImage,
  getFavicon,
  getFaviconURL,
  getLogo
}
