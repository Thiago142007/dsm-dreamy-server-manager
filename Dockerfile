# Dockerfile multi-stage para Dreamy Server Manager
# Build stage com cache otimizado
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Final stage para desenvolvimento
FROM node:24-alpine AS dev
WORKDIR /app

# Criar usuário não-root (usar uid/gid diferentes já que 1000 pode estar em uso)
RUN addgroup -g 1001 dsm && \
    adduser -D -u 1001 -G dsm dsm

# Copiar node_modules do builder
COPY --from=builder /app/node_modules ./node_modules

# Copiar código-fonte
COPY . .

# Criar diretórios de dados
RUN mkdir -p /app/data/runtime /app/data/servers /app/data/storage /app/logs /app/backups /app/config /app/server && \
    chown -R dsm:dsm /app

# Alternar para usuário não-root
USER dsm

# Expor porta
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))" || exit 1

# Iniciar servidor
CMD ["node", "src/server.js"]

# ============================================================
# Production stage - multi-stage otimizado
FROM node:24-alpine AS production

WORKDIR /app

# Criar usuário não-root
RUN addgroup -g 1001 dsm && \
    adduser -D -u 1001 -G dsm dsm

# Copiar node_modules do builder
COPY --from=builder /app/node_modules ./node_modules

# Copiar apenas arquivos necessários para produção
COPY --chown=dsm:dsm src ./src
COPY --chown=dsm:dsm public ./public
COPY --chown=dsm:dsm scripts ./scripts
COPY --chown=dsm:dsm package*.json ./

# Criar diretórios de dados
RUN mkdir -p /app/data/runtime /app/data/servers /app/data/storage /app/logs /app/backups /app/config /app/server && \
    chown -R dsm:dsm /app

# Alternar para usuário não-root
USER dsm

# Variáveis de ambiente
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

# Expor porta
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))" || exit 1

# Iniciar servidor
CMD ["node", "src/server.js"]
