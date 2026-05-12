FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Bundle app source
COPY . .

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Use a non-root user
USER node

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/healthcheck || exit 1

EXPOSE 3000

CMD ["node", "server.js"]
