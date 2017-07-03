// const co = require('co').wrap
// const promisify = require('pify')
// const Jimp = promisify(require('jimp'))
// const DataURI = require('datauri')
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

// function getHandleFromName (name) {
//   return name.replace(/[^A-Za-z]/g, '').toLowerCase()
// }

// module.exports = {
//   getDataURI,
//   getHandleFromName
// }
