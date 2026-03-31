# ---- Builder stage ----
FROM node:24-alpine AS builder

RUN apk add --no-cache build-base cmake python3 python3-dev py3-pip openssl-dev libffi-dev

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY tsconfig.json ./
COPY src/ src/

RUN yarn build

# Python + packages for the data skill (compiled here, copied to prod)
RUN pip3 install --no-cache-dir --break-system-packages \
      snowflake-connector-python==3.18.0 \
      cryptography==46.0.0 \
      dbt-metricflow==0.11.0 \
      boto3

# ---- Production stage ----
FROM node:24-alpine

RUN apk add --no-cache tini github-cli curl jq python3 aws-cli bash

ENV NODE_ENV=production

WORKDIR /app

COPY --from=builder /app/dist dist/
COPY --from=builder /app/node_modules node_modules/
COPY --from=builder /app/package.json package.json
COPY --from=builder /usr/lib/python3.12 /usr/lib/python3.12
COPY --from=builder /usr/bin/mf /usr/bin/mf
COPY --from=builder /usr/bin/dbt /usr/bin/dbt

# Runtime assets read by agent at startup
COPY prompts/ prompts/
COPY skills/ skills/
COPY .env.default .env.default

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--enable-source-maps", "--abort-on-uncaught-exception", "--unhandled-rejections=strict", "dist/index.js"]
