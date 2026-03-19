# ---- Builder stage ----
FROM node:24-alpine AS builder

RUN apk add --no-cache build-base cmake python3

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY tsconfig.json ./
COPY src/ src/

RUN yarn build

# ---- Production stage ----
FROM node:24-alpine

RUN apk add --no-cache tini github-cli curl jq

ENV NODE_ENV=production

WORKDIR /app

COPY --from=builder /app/dist dist/
COPY --from=builder /app/node_modules node_modules/
COPY --from=builder /app/package.json package.json

# Runtime assets read by agent at startup
COPY prompts/ prompts/
COPY skills/ skills/
COPY .env.default .env.default

# Python + packages for the data skill
RUN apk add --no-cache python3 py3-pip && \
    pip3 install --no-cache-dir --break-system-packages \
      snowflake-connector-python==3.18.0 \
      cryptography==46.0.0 \
      "dbt-metricflow[snowflake]==0.11.0" \
      boto3

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--enable-source-maps", "--abort-on-uncaught-exception", "--unhandled-rejections=strict", "dist/index.js"]
