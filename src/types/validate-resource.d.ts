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

  interface IParseEnumValueOpts {
    model: any
    value: string | ResourceStub
  }

  export interface Utils {
    parseId(id:string): ParsedResourceStub
    parseStub(stub:ResourceStub): ParsedResourceStub
    parseEnumValue(IParseEnumValueOpts):ResourceStub
    omitVirtual(obj:any): any
    omitVirtualDeep(obj:any): any
    hasVirtualDeep(obj:any): boolean
    setVirtual(obj:any, props:any): any
    pickVirtual(obj:any): any
    stripVirtual(obj:any): any
    pickVirtual(obj:any): any
    isInstantiable(obj:any): boolean
    getPropertyTitle({ model: any, propertyName: string }): string
  }

  class RequiredError extends Error {
    properties: string[]
  }

  type RequiredErrorCtor = {
    new(): RequiredError
  }

  class InvalidPropertyValueError extends Error {
    property: string
  }

  type InvalidPropertyValueErrorCtor = {
    new(): InvalidPropertyValueError
  }

  type ValidationErrors = {
    Required: RequiredErrorCtor
    InvalidPropertyValue: InvalidPropertyValueErrorCtor
  }

  const utils: Utils
  const resource: ValidateResource
  const Errors: ValidationErrors
  export { utils, resource, Errors }
}
