#!/bin/bash

npm run build:yml &
npm run localstack:start &
wait
npm run gen:localresources
