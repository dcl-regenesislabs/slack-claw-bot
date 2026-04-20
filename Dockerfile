FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    tini git build-essential cmake curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN GH_VERSION=2.67.0 \
    && curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" \
       | tar xz -C /usr/local --strip-components=1

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
COPY prompts/ prompts/
COPY skills/ skills/

# Compile TypeScript to dist/ so production runs a single node process
# instead of the 5-deep tree (npm → tsx → node → esbuild) that plain
# `tsx src/index.ts` produces — that stack consumes ~500 MB of RSS on
# small App Platform instances.
RUN npm run build:dist

ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/index.js"]
