# --- Build stage ---
FROM node:24-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Serve stage ---
FROM nginx:1.30-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY nginx/site.conf nginx/tls.conf nginx/test-ca.conf nginx/headers.conf /etc/nginx/prism/
COPY nginx.conf /etc/nginx/prism/plain.conf
COPY --chmod=755 nginx/tls-on.sh /docker-entrypoint.d/40-prism-tls-on.sh
COPY --chmod=755 nginx/real-ip.sh /docker-entrypoint.d/45-prism-real-ip.sh
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
