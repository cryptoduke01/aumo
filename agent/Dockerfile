FROM node:20-slim

WORKDIR /app

# Install all dependencies (tsx is needed at runtime to run the TypeScript entrypoint).
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=production
EXPOSE 8080

# Hosted mode: status HTTP server + the decision loop.
CMD ["npm", "run", "serve"]
