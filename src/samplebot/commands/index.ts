
import { command as help } from './help'
import { command as listproducts } from './listproducts'
import { command as forgetme } from './forgetme'
import { command as setproductenabled } from './setproductenabled'
// import { command as setautoverify } from './setautoverify'
import { command as setautoapprove } from './setautoapprove'
import { command as addfriend } from './addfriend'
import { command as tours } from './tours'
import { command as message } from './message'
import { command as getconf } from './getconf'
import { command as approve } from './approve'
import { command as deny } from './deny'
import { command as encryptbucket } from './encryptbucket'
import { command as getlaunchlink } from './getlaunchlink'
import { command as enablebinary } from './enable-binary'

export {
  help,
  listproducts,
  forgetme,
  setproductenabled,
  // setautoverify,
  setautoapprove,
  addfriend,
  tours,
  message,
  getconf,
  approve,
  deny,
  getlaunchlink,
  // sudo only
  encryptbucket,
  enablebinary
}
