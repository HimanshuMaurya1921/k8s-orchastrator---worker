# Stage 1: Build
FROM node:20-alpine AS build

WORKDIR /app

# Add build arguments for Vite environment variables
ARG VITE_API_URL
ARG VITE_WORKER_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WORKER_URL=$VITE_WORKER_URL

# Install dependencies based on the lockfile
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Stage 2: Serve
FROM nginx:alpine

# Copy static assets from build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Custom nginx config for SPA routing
RUN echo 'server { \
    listen 80; \
    location / { \
        root /usr/share/nginx/html; \
        index index.html index.htm; \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
