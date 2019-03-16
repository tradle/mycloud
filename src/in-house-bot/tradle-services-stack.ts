import { post } from '../utils'
import { RegisterPushNotifierOpts } from './types'

export interface TradleServicesStackOpts {
  apiKey: string
  endpoint: string
}
export class TradleServicesStack {
  constructor(private opts: TradleServicesStackOpts) {}
  public registerPushNotifier = async (opts: RegisterPushNotifierOpts) => {
    const { accountId, permalink, region } = opts
    const body = {
      accountId,
      permalink,
      region
    }

    const postOpts: any = {}
    if (this.opts.apiKey) {
      postOpts.headers = { 'x-api-key': this.opts.apiKey }
    }

    await post(`${this.opts.endpoint}/pns/publisher`, body, postOpts)
  }
}

export const createServicesStackApi = (opts: TradleServicesStackOpts) =>
  new TradleServicesStack(opts)
