import querystring = require('querystring')
import { IDeepLink } from './types'
import { WEB_APP_URL, MOBILE_APP_URL } from './constants'

const DEFAULT_BASE_URLS = {
  web: WEB_APP_URL,
  mobile: MOBILE_APP_URL
}

const DEFAULT_OPTS = { baseUrls: DEFAULT_BASE_URLS }

type BaseUrls = {
  web?: string
  mobile?: string
}

export default class AppLinks {
  private baseUrls: BaseUrls
  constructor({ baseUrls }: {
    baseUrls: BaseUrls
  }=DEFAULT_OPTS) {
    this.baseUrls = baseUrls
  }

  public getAppLink = ({ path, query, platform }) => {
    const qs = querystring.stringify(query)
    const baseUrl = this.baseUrls[platform]
    if (!baseUrl) {
      throw new Error(`missing baseUrl for platform: ${platform}`)
    }

    if (platform === 'mobile') {
      return `${this.baseUrls.mobile}/${path}?${qs}`
    }

    return `${this.baseUrls.web}/#/${path}?${qs}`
  }

  public getChatLink = ({ provider, host, platform }: IDeepLink) => {
    return this.getAppLink({
      path: 'chat',
      query: {
        permalink: provider,
        url: host
      },
      platform
    })
  }
}

export { AppLinks }
export const createLinker = (opts?) => new AppLinks(opts)
