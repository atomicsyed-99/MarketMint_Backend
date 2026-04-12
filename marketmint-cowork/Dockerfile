# use the official Bun image
# see all versions at https://hub.docker.com/r/oven/bun/tags
FROM oven/bun:alpine AS base
WORKDIR /usr/src/app

# Install all dependencies (dev included for mastra build)
FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lock /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

# Install production dependencies only
RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# Build stage — run mastra build (optionally with studio)
FROM base AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY . .
ENV NODE_ENV=production
ARG BUILD_WITH_STUDIO=false
RUN if [ "$BUILD_WITH_STUDIO" = "true" ]; then bun run build:studio; else bun run build; fi

# Final release image
FROM base AS release
COPY --from=install /temp/prod/node_modules node_modules
COPY --from=prerelease /usr/src/app/.mastra/output .mastra/output
COPY --from=prerelease /usr/src/app/src/mastra/skills src/mastra/skills
COPY --from=prerelease /usr/src/app/drizzle drizzle
COPY scripts scripts
COPY drizzle.config.ts .
COPY package.json .
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh
ENV NODE_TLS_REJECT_UNAUTHORIZED=0

USER bun
EXPOSE 4111/tcp
ENTRYPOINT [ "./entrypoint.sh" ]
