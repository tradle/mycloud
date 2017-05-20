#!/bin/bash

export SLS_DEBUG=*
export IS_LOCAL=1
cat test/fixtures/unsigned.json | sls invoke local -f sign
