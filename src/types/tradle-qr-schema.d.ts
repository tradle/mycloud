declare module '@tradle/qr-schema' {

  // type LinksPerPlatform = {
  //   mobile: string
  //   web: string
  // }

  export type QRInput = {
    schema: string
    data: any
  }

  type GetResourceLinkOpts = {
    platform: string
    baseUrl?: string
    type: string
    permalink?: string
    link?: string
  }

  type GetAppLinkOpts = {
    platform: string
    baseUrl?: string
    path: string
    query?: any
  }

  export type AppLinks = {
    getAppLink: (opts:GetAppLinkOpts) => string
    // getAppLinks: (opts:any) => LinksPerPlatform
    getChatLink: (opts:any) => string
    // getChatLinks: (opts:any) => LinksPerPlatform
    getImportDataLink: (opts:any) => string
    // getImportDataLinks: (opts:any) => LinksPerPlatform
    getApplyForProductLink: (opts:any) => string
    getResourceLink: (opts:GetResourceLinkOpts) => string
    // getApplyForProductLinks: (opts:any) => LinksPerPlatform
    inferSchemaAndData: (opts: any) => QRInput
  }

  const links: AppLinks
  const toHex: (input: QRInput) => string
  export { links, toHex }
}
