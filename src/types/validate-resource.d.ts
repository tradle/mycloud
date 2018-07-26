declare module '@tradle/validate-resource' {

  export type ValidateResourceOpts = {
    resource: any
    models: any
    model?: string|any
    allowUnknown?: boolean
    partial?: boolean
  }

  export type ValidateResource = (opts:ValidateResourceOpts) => void

  export interface ResourceStub {
    _t: string
    _link: string
    _permalink: string
    _displayName?: string
  }

  export interface ExtendedResourceStub extends ResourceStub {
    _displayName?: string
    [x: string]: any
  }

  export interface ParsedPermId {
    type: string
    permalink: string
  }

  export interface ParsedResourceStub extends ParsedPermId {
    link: string
    title?: string
  }

  interface IParseEnumValueOpts {
    model: any
    value: string | ResourceStub
  }

  type IsDescendantOfInput = {
    models: any
    a: string
    b: string
  }

  type GetPropertyTitleInput = {
    model: any
    propertyName: string
  }

  type TransformPropertyInput = {
    models: any
    property: any
  }

  type TransformResourceInput = {
    models: any
    resource: any
  }

  export type GetResourceIdentifierInput = {
    type?: string
    permalink?: string
    id?: string
    [key: string]: any
  }

  export type GetResourceIdentifierOutput = {
    type: string
    permalink: string
    link?: string
  }

  export type OmitBacklinksInput = {
    model: any
    resource: any
  }

  export type EnumStub = {
    id: string
    title?: string
  }

  export interface Utils {
    // parseId(id:string): ParsedResourceStub
    parseStub(stub:ResourceStub): ParsedResourceStub
    parseEnumValue(IParseEnumValueOpts):EnumStub
    omitVirtual(obj:any): any
    omitVirtualDeep(obj:TransformResourceInput): any
    hasVirtualDeep(obj:any): boolean
    setVirtual(obj:any, props:any): any
    pickVirtual(obj:any): any
    stripVirtual(obj:any): any
    pickVirtual(obj:any): any
    isInstantiable(obj:any): boolean
    isDescendantOf(opts: IsDescendantOfInput): boolean
    getPropertyTitle(opts: GetPropertyTitleInput): string
    isInlinedProperty(opts: TransformPropertyInput): string
    isEnumProperty(opts: TransformPropertyInput): string
    getResourceIdentifier(opts: GetResourceIdentifierInput): GetResourceIdentifierOutput
    getPermId(opts: GetResourceIdentifierInput): string
    parsePermId(permid: string): ParsedPermId
    omitBacklinks(opts: OmitBacklinksInput): any
    pickBacklinks(opts: OmitBacklinksInput): any
    isBacklinkProperty(prop: any): any
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
