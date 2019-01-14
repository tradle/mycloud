import { reduce } from 'lodash'
import { links } from '@tradle/qr-schema'
import { AppLinks } from './types'
import Errors from './errors'
import { trimLeadingSlashes } from './string-utils'
import {
  WEB_APP_URL,
  MOBILE_APP_URL,
  APP_SCHEME,
} from './constants'

type BaseUrls = {
  mobile: string
  web: string
}

const defaultBaseUrls:BaseUrls = {
  mobile: MOBILE_APP_URL,
  web: WEB_APP_URL
}

export const createLinker = (baseUrls:Partial<BaseUrls>):AppLinks => {
  return reduce(links, (result:AppLinks, fn:Function, key:string) => {
    result[key] = opts => {
      return fn({
        ...opts,
        baseUrl: opts.baseUrl || baseUrls[opts.platform] || defaultBaseUrls[opts.platform]
      })
    }

    return result
  }, {} as AppLinks)
}

export const appLinks = createLinker({
  mobile: MOBILE_APP_URL,
  web: WEB_APP_URL
})

export const toAppSchemeLink = (link: string) => {
  if (!link.startsWith(MOBILE_APP_URL)) {
    throw new Errors.InvalidInput(`expected link to start with ${MOBILE_APP_URL}`)
  }

  link = link.slice(MOBILE_APP_URL.length)
  link = trimLeadingSlashes(link)
  return `${APP_SCHEME}${link}`
}
