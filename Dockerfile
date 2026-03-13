FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    tini git build-essential cmake curl \
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

ENTRYPOINT ["tini", "--"]
CMD ["npx", "tsx", "src/index.ts"]
