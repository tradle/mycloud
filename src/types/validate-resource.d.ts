declare module '@tradle/validate-resource' {
  type ValidateResourceOpts = {
    resource: any
    models: any
    model?: string|any
  }

  export type ValidateResource = (opts:ValidateResourceOpts) => void

  export interface ResourceStub {
    id: string
    title?: string
  }

  export interface ParsedResourceStub {
    type: string
    link: string
    permalink: string
    title?: string
  }

  export interface Utils {
    parseId(id:string): ParsedResourceStub
    parseStub(stub:ResourceStub): ParsedResourceStub
    omitVirtual(obj:any): any
    omitVirtualDeep(obj:any): any
    hasVirtualDeep(obj:any): boolean
    setVirtual(obj:any, props:any): any
    pickVirtual(obj:any): any
    stripVirtual(obj:any): any
    pickVirtual(obj:any): any
    isInstantiable(obj:any): boolean
  }

  const utils: Utils
  const resource: ValidateResource
  export { utils, resource }
}
