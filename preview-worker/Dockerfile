FROM node:20-alpine

# Install basic tools for Next.js and process management
RUN apk add --no-cache curl tar procps

WORKDIR /app

# Copy worker server files
COPY package.json package-lock.json ./
RUN npm ci

# Copy the Next.js template
COPY template ./template

# Pre-install Next.js dependencies inside the template
# This runs during image build so workers don't npm install at runtime
WORKDIR /app/template
RUN npm ci

# Go back to app root
WORKDIR /app

# Copy worker server files
COPY worker.js ./

# Create workspace directory
RUN mkdir -p /workspace

EXPOSE 3000

CMD ["node", "--expose-gc", "worker.js"]
