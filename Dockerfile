FROM node:22-slim

# The quotation email attachment uses Puppeteer to render the same print-page
# HTML as the Download PDF button. Install a compatible system Chromium instead
# of relying on an ephemeral /tmp binary in the managed runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-noto-cjk fontconfig \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY . .

# Custom Docker deployments own both the Vite frontend and Express server build.
RUN npm install -g corepack@latest \
  && corepack pnpm install \
  && corepack pnpm run build

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
