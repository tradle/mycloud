
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
// import { command as encryptbucket } from './encryptbucket'
import { command as updatemycloud } from './updatemycloud'
// import { command as enablebinary } from './enable-binary'
import { command as model } from './model'
import { command as push } from './push'
import { command as links } from './links'
import { command as sealpending } from './sealpending'
import { command as clear } from './clear'

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
  updatemycloud,
  model,
  links,
  // sudo only
  // encryptbucket,
  // enablebinary,
  push,
  sealpending,
  clear
}
