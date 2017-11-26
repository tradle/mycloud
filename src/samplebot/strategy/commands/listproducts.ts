export default {
  name: 'listproducts',
  examples: [
    '/listproducts'
  ],
  description: 'see a list of products',
  exec: async function ({ context, req, command }) {
    const { productsAPI } = context
    await productsAPI.sendProductList(req)
  }
}
