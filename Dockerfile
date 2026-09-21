FROM node:22-alpine AS base

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm ci

COPY . .

FROM base AS server

EXPOSE 3000

CMD ["npm", "run", "dev", "--workspace", "apps/server"]

FROM base AS web

EXPOSE 5173

CMD ["npm", "run", "dev", "--workspace", "apps/web", "--", "--host", "0.0.0.0"]
