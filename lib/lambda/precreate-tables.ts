
import { preCreateTables } from '../configure-provider'
import * as wrap from '../wrap'
import { db } from '../../samplebot'

export const handler = wrap(event => preCreateTables({ db, ids: event }))
