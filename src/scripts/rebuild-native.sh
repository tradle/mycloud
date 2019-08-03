#!/bin/bash

set -euo pipefail

# native_modules=$($(dirname $0)/list-native-modules.sh)
native_modules="secp256k1 sha3 keccak scrypt fsevents segfault-handler"
npm rebuild $native_modules
