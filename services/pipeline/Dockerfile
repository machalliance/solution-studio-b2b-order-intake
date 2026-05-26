FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY src ./src
EXPOSE 3002
CMD ["node", "src/index.js"]
