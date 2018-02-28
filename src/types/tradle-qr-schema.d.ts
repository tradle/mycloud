declare module '@tradle/qr-schema' {

  // type LinksPerPlatform = {
  //   mobile: string
  //   web: string
  // }

  export type QRInput = {
    schema: string
    data: any
  }

  export type AppLinks = {
    getAppLink: (opts:any) => string
    // getAppLinks: (opts:any) => LinksPerPlatform
    getChatLink: (opts:any) => string
    // getChatLinks: (opts:any) => LinksPerPlatform
    getImportDataLink: (opts:any) => string
    // getImportDataLinks: (opts:any) => LinksPerPlatform
    getApplyForProductLink: (opts:any) => string
    // getApplyForProductLinks: (opts:any) => LinksPerPlatform
    inferSchemaAndData: (opts: any) => QRInput
  }

  const links: AppLinks
  const toHex: (input: QRInput) => string
  export { links, toHex }
}
