import { reduce, transform } from 'lodash'
import { links } from '@tradle/qr-schema'
import { AppLinks } from './types'
import {
  WEB_APP_URL,
  MOBILE_APP_URL
} from './constants'

const getBaseUrl = platform => platform === 'mobile' ? MOBILE_APP_URL : WEB_APP_URL

const appLinks:AppLinks = reduce(links, (result:AppLinks, fn:Function, key) => {
  result[key] = opts => fn({
    ...opts,
    baseUrl: opts.baseUrl || getBaseUrl(opts.platform)
  })

  return result
}, <AppLinks>{})

export { appLinks }
