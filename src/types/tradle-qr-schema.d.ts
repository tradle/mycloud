declare module '@tradle/qr-schema' {

  export type QRInput = {
    schema: string
    data: any
  }

  export type AppLinks = {
    getAppLink: (opts:any) => string
    getChatLink: (opts:any) => string
    getImportDataLink: (opts:any) => string
    getApplyForProductLink: (opts:any) => string
    inferSchemaAndData: (opts: any) => QRInput
  }

  const links: AppLinks
  const toHex: (input: QRInput) => string
  export { links, toHex }
}
