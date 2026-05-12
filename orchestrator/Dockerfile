FROM node:20-alpine

WORKDIR /app

# Change ownership of the working directory to the node user
RUN chown -R node:node /app

# Switch to the non-root 'node' user
USER node

# Install app dependencies
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci

# Bundle app source
COPY --chown=node:node . .

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

EXPOSE 3001

CMD ["node", "src/server.js"]
