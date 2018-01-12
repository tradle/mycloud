import Router = require('koa-router')

export const route = (methods:string|string[], path:string='/') => {
  const router = new Router()
  ;[].concat(methods).forEach(method => {
    router[method](path, async (ctx, next) => {
      await next()
    })
  })

  return router.routes()
}

export const get = (path?:string) => route('get', path)
export const put = (path?:string) => route('put', path)
export const post = (path?:string) => route('post', path)
export const del = (path?:string) => route('del', path)
export const head = (path?:string) => route('head', path)
