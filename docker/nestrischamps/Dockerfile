# syntax=docker/dockerfile:1
FROM node:22-bullseye
RUN apt-get update && apt-get install -y git

RUN git clone https://github.com/britneyfrei/nestrischamps.git
WORKDIR ./nestrischamps

RUN npm ci
CMD ["npm", "run", "start"]
