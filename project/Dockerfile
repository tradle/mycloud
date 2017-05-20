FROM lambci/lambda:build

ENV AWS_DEFAULT_REGION us-east-1

ADD . .

RUN npm install --production

CMD ["npm", "run", "deploy"]
