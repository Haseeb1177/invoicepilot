FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && mkdir -p data && chown -R node:node /app
USER node
ENV NODE_ENV=production HOST=0.0.0.0 DB_PATH=/app/data/app.sqlite
EXPOSE 3000
CMD ["npm", "start"]
