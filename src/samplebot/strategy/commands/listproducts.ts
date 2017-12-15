export default {
  name: 'listproducts',
  examples: [
    '/listproducts'
  ],
  aliases: [
    '/lsproducts',
    '/ls-products'
  ],
  description: 'see a list of products',
  exec: async function ({ context, req, command }) {
    const { productsAPI } = context
    await productsAPI.sendProductList(req)
  }
}
