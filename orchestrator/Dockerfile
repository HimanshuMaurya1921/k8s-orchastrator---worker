FROM node:20-alpine

WORKDIR /app

# Install app dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Bundle app source
COPY . .

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

EXPOSE 3001

CMD ["node", "src/server.js"]
