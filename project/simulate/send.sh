#!/bin/bash

export SLS_DEBUG=*
export DEBUG=*
export IS_LOCAL=1
cat test/fixtures/events/send.json | sls invoke local -f send
