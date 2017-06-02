#!/bin/bash

SLS_DEBUG=* DEBUG=tradle* IS_LOCAL=1 sls invoke local -f prereceive --path ./project/test/fixtures/alice/receive.json
