
import buildResource from '@tradle/build-resource'
import validateResource from '@tradle/validate-resource'
import { Model, IModelsMixinTarget, ITradleObject } from './types'
import Errors from './errors'

export const mixin = (target: IModelsMixinTarget) => {
  // Note: don't cache target.models as it might be a dynamic prop

  target.buildResource = (model: Model|string) => {
    if (typeof model === 'string') {
      model = target.getModel(model)
    } else if (!model) {
      throw new Errors.InvalidInput(`expected model "model"`)
    }

    return buildResource({
      models: target.models,
      model,
    })
  }

  target.buildStub = (resource: ITradleObject) => buildResource.stub({
    models: target.models,
    resource
  })

  target.validateResource = (resource: ITradleObject) => validateResource.resource({
    models: target.models,
    resource
  })

  target.getModel = (id: string) => {
    const model = target.models[id]
    if (!model) throw new Errors.InvalidInput(`model not found: ${id}`)

    return model
  }

  return target
}
