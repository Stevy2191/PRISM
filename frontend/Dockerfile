# --- Build stage ---
FROM node:24-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# --- Serve stage ---
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY nginx/site.conf nginx/tls.conf nginx/test-ca.conf /etc/nginx/prism/
COPY nginx.conf /etc/nginx/prism/plain.conf
COPY --chmod=755 nginx/tls-on.sh /docker-entrypoint.d/40-prism-tls-on.sh
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
