#!/bin/bash

set -euo pipefail

# native_modules=$($(dirname $0)/list-native-modules.sh)
native_modules="secp256k1 keccak segfault-handler sharp napi-build-utils"
npm rebuild $native_modules
