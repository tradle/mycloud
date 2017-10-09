
import { preCreateTables } from '../configure-provider'
import * as wrap from '../wrap'
import { productsAPI } from '../../samplebot'

// TODO: reschedule on LimitExceededException
export const handler = wrap(event => preCreateTables({ productsAPI, ids: event }))
