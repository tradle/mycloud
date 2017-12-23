
export = function createSealsAPI ({ provider, seals }) {
  const createSeal = async (opts) => {
    const chainKey = await provider.getMyChainKey()
    await seals.create({
      ...opts,
      key: chainKey
    })
  }

  return {
    create: createSeal,
    get: seals.get
  }
}
