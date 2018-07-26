#!/bin/bash

echo '{"force": true}' | ./node_modules/.bin/sls invoke -f init
