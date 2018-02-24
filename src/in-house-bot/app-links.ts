import { AppLinks as Base } from '../app-links'
import { IDeepLink, IApplyForProductDeepLink, IImportDataDeepLink } from './types'

export default class AppLinks extends Base {
  public getImportDataLink = ({ provider, host, platform, dataHash }: IImportDataDeepLink) => {
    return this.getAppLink({
      path: 'chat',
      query: {
        permalink: provider,
        url: host,
        dataHash
      },
      platform
    })
  }

  public getApplyForProductLink = ({ provider, host, product, platform }: IApplyForProductDeepLink) => {
    return this.getAppLink({
      path: 'applyForProduct',
      query: {
        permalink: provider,
        url: host,
        product
      },
      platform
    })
  }

  public inferSchemaAndData = ({ provider, host, data }) => {
    const { claimId, product } = data
    if (claimId) {
      return {
        schema: 'ImportData',
        data: { provider, host, dataHash: claimId }
      }
    }

    if (product) {
      return {
        schema: 'ApplyForProduct',
        data: { provider, host, product }
      }
    }

    return {
      schema: 'AddProvider',
      data: { provider, host }
    }
  }
}

export { AppLinks }
export const createLinker = (opts?) => new AppLinks(opts)
