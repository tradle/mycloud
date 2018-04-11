
import buildResource from '@tradle/build-resource'
import validateResource from '@tradle/validate-resource'
import { Model, IModelsMixinTarget, ITradleObject } from '../types'

export const mixin = (target: IModelsMixinTarget) => {
  // Note: don't cache target.models as it might be a dynamic prop

  target.buildResource = (model?: Model) => buildResource({
    models: target.models,
    model
  })

  target.buildStub = (resource: ITradleObject) => buildResource.stub({
    models: target.models,
    resource
  })

  target.validate = (resource: ITradleObject) => validateResource.resource({
    models: target.models,
    resource
  })

  return target
}
