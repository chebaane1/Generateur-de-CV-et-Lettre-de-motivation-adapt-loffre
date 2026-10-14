FROM node:22-slim

# Claude Code CLI, used headless with your Pro plan
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY web ./web

# Type errors stop the build; then drop the dev tools
RUN npm run typecheck && npm prune --omit=dev

USER node
EXPOSE 8080
# tsx runs TypeScript directly, so prompts/prompts.ts and web/app.ts stay editable without a rebuild
CMD ["node", "--import", "tsx", "src/server.ts"]
