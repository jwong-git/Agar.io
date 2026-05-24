# Single-stage image: build the client and run the Node server via tsx.
# Small enough for a hobby game; uses Alpine for a slim base.
FROM node:22-alpine

WORKDIR /app

# install deps first so this layer caches when only source changes
COPY package.json package-lock.json ./
RUN npm ci

# copy the rest of the project, then build the client to dist/
COPY . .
RUN npm run build

ENV NODE_ENV=production
# Fly.io sets PORT at runtime; this is the fallback for local `docker run`.
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
