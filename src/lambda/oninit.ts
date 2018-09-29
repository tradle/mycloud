// import { fromCloudFormation } from '../lambda'

// export const createLambda = () => fromCloudFormation().use(createMiddleware())

export const createMiddleware = () => async (ctx, next) => {
  const { event, components } = ctx
  await components.bot.fire(`stack:${event.type}`, ctx.event)
  await next()
}
