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
# (Removed explicit --max-old-space-size: on 1GB+ VMs Node auto-sizes the heap
# sensibly and leaves room for native Buffers / socket queues. The earlier
# explicit 400MB on a 512MB VM starved native memory and caused process-OOM.)
EXPOSE 8080

CMD ["npm", "start"]
