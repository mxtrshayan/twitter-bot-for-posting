FROM mcr.microsoft.com/playwright:v1.56.1-noble
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build
RUN mkdir -p /app/data && chown pwuser:pwuser /app/data
ENV NODE_ENV=production
EXPOSE 3000 3001
CMD ["npm","run","start"]
