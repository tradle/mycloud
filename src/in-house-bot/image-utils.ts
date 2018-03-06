import { parse as parseURL, format as formatURL } from 'url'
// import Jimp = promisify(require('jimp'))
import promisify from 'pify'
import DataURI from 'datauri'
import fetch from 'node-fetch'
// import request from 'superagent'
import { fetchFavicons } from '@meltwater/fetch-favicon'
import { domainToUrl } from '../utils'

export type Favicon = {
  url: string
  image: {
    mimeType: string
    data: Buffer
  }
}

export const getFaviconUrl = async (siteUrl: string):Promise<string> => {
  const icons = await fetchFavicons(domainToUrl(siteUrl))
  const icon = chooseIcon(icons)
  return getAbsoluteURL(siteUrl, icon)
}

export const getFavicon = async (siteUrl: string):Promise<Favicon> => {
  const faviconUrl = await getFaviconUrl(siteUrl)
  return {
    url: faviconUrl,
    image: await downloadImage(faviconUrl)
  }
}

export const downloadImage = async (url: string) => {
  const res = await fetch(url)
  if (res.status > 300) {
    const text = await res.text()
    throw new Error(text)
  }

  const arrayBuffer = await res.arrayBuffer()
  const data = new Buffer(arrayBuffer)
  const mimeType = res.headers.get('content-type').split(';')[0]
  return {
    data,
    mimeType
  }
}

// export const downloadImage = async (url) => {
//   const { ok, body, text, header } = await request(url)
//     .set('Accept', 'application/octet-stream')

//   if (!ok) {
//     throw new Error(text)
//   }

//   return {
//     type: header['content-type'],
//     data: body
//   }
// }

// const getDataURI = async (url) => {
//   if (/^\".*\"$/.test(url)) {
//     url = url.slice(1, url.length - 1)
//   }

//   if (/^data:/.test(url)) return url

//   const image = await Jimp.read(url)
//   const width = image.bitmap.width
//   const height = image.bitmap.height
//   const biggest = Math.max(width, height)
//   const scale = (100 / biggest).toFixed(2)
//   image.scale(Number(scale))
//   const buf = await promisify(image.getBuffer.bind(image))(Jimp.MIME_PNG)
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

export const getDataURI = async (image, ext) => {
  // const ext = url.split('.').pop()
  const uri = new DataURI()
  uri.format(`.${ext}`, image)
  return uri.content
}

export const getLogo = async ({ logo, domain }) => {
  if (!logo) {
    logo = await getFaviconUrl(domain)
  }

  if (!/^data:image/.test(logo)) {
    const { data, mimeType } = await downloadImage(logo)
    const ext = mimeType ? mimeType.split('/')[1] : logo.slice(logo.lastIndexOf('.'))
    logo = await getDataURI(data, ext)
  }

  return logo
}

// copied and adapted from @meltwater/fetch-favicon/source/markActiveFavicon.js
const predicates = [
  (f, s) => f.name === 'apple-touch-icon-precomposed' && f.size >= s,
  (f, s) => f.name === 'apple-touch-icon' && f.size >= s,
  (f, s) => f.name === 'shortcut icon' && f.size >= s,
  (f, s) => f.name === 'twitter:image' && f.size >= s,
  (f, s) => f.name === 'icon' && f.size >= s,
  (f, s) => f.name === 'og:image' && f.size >= s,
  (f, s) => f.name === 'msapplication-TileImage' && f.size >= s,

  // no size
  (f, s) => f.name === 'apple-touch-icon-precomposed',
  (f, s) => f.name === 'apple-touch-icon',
  (f, s) => f.name === 'shortcut icon',
  (f, s) => f.name === 'twitter:image',
  (f, s) => f.name === 'icon',
  (f, s) => f.name === 'og:image',
  (f, s) => f.name === 'msapplication-TileImage',
  (f, s) => f.name === 'favicon.ico'
]

const chooseIcon = (favicons, minSize?) => {
  for (let i = 0; i < predicates.length; i++) {
    let result = favicons.find(favicon => predicates[i](favicon, minSize))
    if (result) return result.href
  }
}
