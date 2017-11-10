export default {
  name: 'forgetme',
  description: 'exercise your right to be forgotten',
  exec: async function ({ context, req, command }) {
    const { productsAPI } = context
    await productsAPI.forgetUser(req)
  }
}
