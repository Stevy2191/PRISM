# PRISM backend image
FROM node:24-alpine

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

# Build-time version stamp. Declared here, after the dependency and source
# COPY layers, so changing it doesn't invalidate the npm install cache — every
# build has a different value.
#
# CI passes the version metadata-action derives from the ref: "0.2.0" for a
# v0.2.0 tag, the branch name for a branch push. The default covers an image
# built by hand from a checkout, which has no ref to derive anything from.
ARG APP_VERSION=dev
ARG GIT_SHA=unknown
ENV APP_VERSION=$APP_VERSION
ENV GIT_SHA=$GIT_SHA

EXPOSE 3001

# Container health: the API health endpoint.
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "require('http').get('http://localhost:3001/api/v1/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Runs migrations, then starts the server.
ENTRYPOINT ["./docker-entrypoint.sh"]
