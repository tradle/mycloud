#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

java -Djava.library.path="$DIR/DynamoDBLocal/DynamoDBLocal_lib" -jar "$DIR/DynamoDBLocal/DynamoDBLocal.jar" -sharedDb -inMemory
