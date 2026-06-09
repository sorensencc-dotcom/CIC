FROM node:20-alpine

LABEL component="cic-audit"

WORKDIR /app

COPY package*.json ./
RUN npm ci --frozen-lockfile

COPY . .

EXPOSE 7003

ENV NODE_ENV=production
ENV CIC_AUDIT_PORT=7003

CMD ["node", "dist/index.js"]
