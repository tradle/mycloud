import { reduce } from 'lodash'
import { links } from '@tradle/qr-schema'
import { AppLinks } from './types'
import {
  WEB_APP_URL,
  MOBILE_APP_URL
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
