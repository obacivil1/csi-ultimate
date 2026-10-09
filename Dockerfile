FROM node:22

WORKDIR /app

# Browser-based scraping runs in GitHub Actions (see .github/workflows/update-tenders.yml),
# not in this image — keep it lean and deploy only the web server + shipped data.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=production PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "web/server.mjs"]