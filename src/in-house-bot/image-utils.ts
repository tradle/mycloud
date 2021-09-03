// import Jimp = promisify(require('jimp'))
import DataURI from 'datauri'
import fetch from 'node-fetch'
// import request from 'superagent'
import { fetchFavicon } from '@tradle/fetch-favicon'
import { domainToUrl, runWithTimeout } from '../utils'

export type Favicon = {
  url: string
  image: {
    mimeType: string
    data: Buffer
  }
}

export type GetLogoOpts = {
  domain: string
  logo?: string
  timeout?: number
}

export const getLogo = async (opts: GetLogoOpts): Promise<string | void> => {
  const { domain, logo, timeout=5000 } = opts
  if (logo) return logo

  return await runWithTimeout(() => getFaviconUrl(domain), {
    millis: timeout
  })
}

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

export const getFaviconUrl = async (siteUrl: string):Promise<string> => {
  const icon = await fetchFavicon(domainToUrl(siteUrl), 120, {
    predicates
  })
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

  console.log(res)

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
