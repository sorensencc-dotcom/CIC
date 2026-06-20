FROM node:20-alpine

LABEL component="cic-orchestrator"

WORKDIR /app

COPY package*.json ./
RUN npm ci --frozen-lockfile

COPY . .

EXPOSE 7001

ENV NODE_ENV=production
ENV CIC_ORCHESTRATOR_PORT=7001

CMD ["node", "dist/index.js"]
