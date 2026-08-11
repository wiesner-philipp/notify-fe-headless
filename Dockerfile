FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src

ENV NODE_ENV=production

# Health endpoint (see PORT env var)
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

# Run as a non-root user
RUN addgroup -S app && adduser -S app -G app
USER app

CMD ["node", "src/index.js"]
