# PRISM backend image
FROM node:24-alpine

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# App source
COPY . .

# The MCP server's tools, shared with the standalone program in mcp/ (MCP-O):
# /mcp runs them in this process. Built with the named context "mcp"
# (docker buildx --build-context mcp=./mcp; CI and docker-compose.dev.yml
# pass it).
COPY --from=mcp package*.json /mcp/
RUN cd /mcp && npm ci --omit=dev && npm cache clean --force
COPY --from=mcp src /mcp/src
ENV PRISM_MCP_DIR=/mcp

# Agent packages (8a): CI builds the agent and places the packages and their
# manifest.json in agent-dist/ before this image is built (COPY . . above
# brings them in). PRISM signs and serves them to enrolled agents only.
ENV AGENT_DIST_DIR=/app/agent-dist
RUN mkdir -p /app/agent-dist

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
