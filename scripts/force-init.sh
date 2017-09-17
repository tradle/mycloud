#!/bin/bash

echo '{"force": true}' | sls invoke -f init
