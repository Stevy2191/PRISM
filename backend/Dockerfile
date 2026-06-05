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

CMD ["node", "src/index.js"]
