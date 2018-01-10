
export default class KeyValueTable {
  private table:any
  private prefix:string
  constructor ({ table, prefix='' }) {
    this.table = table
    this.prefix = prefix
  }

  public exists = async (key:string):Promise<boolean> => {
    try {
      await this.get(key, {
        AttributesToGet: ['key']
      })

      return true
    } catch (err) {
      return false
    }
  }

  public get = async (key:string, opts:any={}):Promise<any> => {
    try {
      const { value } = await this.table.get({
        Key: this.wrapKey(key),
        ...opts
      })

      return value
    } catch (err) {
      if (err.code === 'ResourceNotFoundException' || err.name === 'NotFound') {
        err.name = 'NotFound'
        err.notFound = true
      }

      throw err
    }
  }

  public put = async (key:string, value):Promise<void> => {
    await this.table.put({
      Item: {
        key: this.getKey(key),
        value
      }
    })
  }

  public del = async (key):Promise<void> => {
    await this.table.del({
      Key: this.wrapKey(key)
    })
  }

  public update = async (key:string, opts:any):Promise<any> => {
    const result = await this.table.update({
      Key: this.wrapKey(key),
      ...opts
    })

    return result && result.value
  }

  public sub = (prefix=''):KeyValueTable => {
    return new KeyValueTable({
      table: this.table,
      prefix: this.prefix + prefix
    })
  }

  private getKey = (key:string) => {
    return this.prefix + key
  }

  private wrapKey = (key:string) => {
    return {
      key: this.prefix + key
    }
  }
}

export { KeyValueTable }
