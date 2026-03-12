FROM node:20-alpine

RUN apk add --no-cache tini github-cli git

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
COPY prompts/ prompts/
COPY skills/ skills/

# Create data directory for sessions and memory
RUN mkdir -p /data/claw/sessions /data/claw/memory/daily /data/claw/memory/users

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npx", "tsx", "src/index.ts"]
