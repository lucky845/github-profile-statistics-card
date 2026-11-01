FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm install typescript ts-node tsconfig-paths tsc-alias --no-save
COPY . .
RUN npm run build || true
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start:prod"]
