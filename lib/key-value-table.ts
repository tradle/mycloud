
export default class KeyValueTable {
  private table:any
  private prefix:string
  constructor ({ table, prefix='' }) {
    this.table = table
    this.prefix = prefix
  }

  public get = async (key:string) => {
    try {
      const { value } = await this.table.get({ Key: { key } })
      return value
    } catch (err) {
      if (err.code === 'ResourceNotFoundException' || err.name === 'NotFound') {
        err.notFound = true
      }

      throw err
    }
  }

  public put = async (key:string, value):Promise<void> => {
    await this.table.put({
      Item: {
        key: this.prefix + key,
        value
      }
    })
  }

  public sub = (prefix=''):KeyValueTable => {
    return new KeyValueTable({
      table: this.table,
      prefix: this.prefix + prefix
    })
  }
}
