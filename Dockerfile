FROM node:25-alpine
WORKDIR /app
COPY package.json server.mjs ./
COPY public ./public
COPY config ./config
ENV NODE_ENV=production PORT=8099
EXPOSE 8099
CMD ["node", "server.mjs"]
