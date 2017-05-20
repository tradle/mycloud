#!/bin/bash

export SLS_DEBUG=*
export DEBUG=tradle*
export IS_LOCAL=1

sls invoke local -f init
# cat ../../fixtures/bob/identity.json | sls invoke local -f addcontact
