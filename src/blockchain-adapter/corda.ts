
// class Seals {
//   create = async ({ link }) => {
//     const [{ _author }, myPermalink] = await Promise.all([
//       this.objects.get(link),
//       this.provider.getMyIdentityPermalink()
//     ])

//     if (_author == myPermalink)
//   }
// }

// class Transactor {
//   constructor() {

//   }
// }

// export = function getNetworkAdapters ({ networkName, privateKey }) {
//   const network = Networks[networkName]
//   const blockchain = network.wrapCommonBlockchain(new Blockr(networkName))
//   const transactor = network.createTransactor({ privateKey, blockchain })
//   return {
//     network,
//     blockchain,
//     transactor
//   }
// }

export = () => ({})
