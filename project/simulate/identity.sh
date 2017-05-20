#!/bin/bash

export SLS_DEBUG=*
export DEBUG=tradle*
export IS_LOCAL=1

sls invoke local -f identity
