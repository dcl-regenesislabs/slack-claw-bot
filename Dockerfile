FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    tini git build-essential cmake \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN (type -p wget >/dev/null || (apt-get update && apt-get install -y wget)) \
    && wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
COPY prompts/ prompts/
COPY skills/ skills/

ENTRYPOINT ["tini", "--"]
CMD ["npx", "tsx", "src/index.ts"]
