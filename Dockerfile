FROM node:24-alpine

LABEL org.opencontainers.image.title="mcp-meteoblue" \
      org.opencontainers.image.description="MCP server for meteoblue weather forecasts, images, and location search" \
      org.opencontainers.image.source="https://github.com/unixfox/mcp-meteoblue" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

COPY --chown=node:node src ./src

USER node

ENTRYPOINT ["node", "src/index.js"]
