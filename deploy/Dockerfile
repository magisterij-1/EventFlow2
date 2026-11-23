FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production FRONTEND_DIST_DIR=/app/frontend

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY backend/server.js ./
COPY backend/database/schema.sql ./database/schema.sql
COPY frontend/ ./frontend/
COPY initialize-database.cjs ./

USER node
EXPOSE 3000
CMD ["sh", "-ec", "node initialize-database.cjs && exec node server.js"]
