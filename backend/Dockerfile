# PRISM backend image
FROM node:22-alpine

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# App source
COPY . .

# Uploads volume mount point
RUN mkdir -p /uploads
VOLUME ["/uploads"]

ENV NODE_ENV=production
EXPOSE 3001

# Container health: the API health endpoint.
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "require('http').get('http://localhost:3001/api/v1/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Runs migrations, then starts the server.
ENTRYPOINT ["./docker-entrypoint.sh"]
