FROM node:8.2-alpine

ENV DYNALITE_VERSION=2.3.2
RUN apk add --no-cache --virtual .gyp \
        python \
        make \
        g++ \
    && npm --unsafe-perm install \
        -g dynalite@${DYNALITE_VERSION} \
    && npm --force cache clear \
    && rm -rf /tmp/* /var/tmp/* \
    && apk del .gyp

EXPOSE 4569

CMD ["dynalite", "--port=4569", "--createTableMs=10", "--deleteTableMs=10", "--updateTableMs=10", "--path=/var/dynamodb"]
