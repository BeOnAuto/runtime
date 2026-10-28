# syntax=docker/dockerfile:1
FROM node:26.11.1-slim@sha256:193fe51b64e77981119c98c2002c9e32a70e2f006fb4d25068ce0558998917f0 AS dependencies
RUN apt-get update \
  && apt-get install --yes --no-install-recommends g++ make python3 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN npm install --global --no-fund --no-audit pnpm@12.11.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches/
COPY packages/server/package.json packages/server/
COPY packages/api/package.json packages/api/
COPY packages/playbooks/package.json packages/playbooks/
COPY packages/config/package.json packages/config/
COPY packages/connections/package.json packages/connections/
COPY packages/definitions/package.json packages/definitions/
COPY packages/identity/package.json packages/identity/
COPY packages/json-schema/package.json packages/json-schema/
COPY packages/ledger/package.json packages/ledger/
COPY packages/meter/package.json packages/meter/
COPY packages/object-storage/package.json packages/object-storage/
COPY packages/operations/package.json packages/operations/
COPY packages/outbound/package.json packages/outbound/
COPY packages/prediction-contract/package.json packages/prediction-contract/
COPY packages/prediction-onnx/package.json packages/prediction-onnx/
COPY packages/providers/package.json packages/providers/
COPY packages/secrets/package.json packages/secrets/
COPY packages/tool-servers/package.json packages/tool-servers/
COPY packages/workflow-engine/package.json packages/workflow-engine/
COPY packages/workflow-host/package.json packages/workflow-host/
COPY capabilities/computation/package.json capabilities/computation/
COPY capabilities/coordination/package.json capabilities/coordination/
COPY capabilities/interaction/package.json capabilities/interaction/
COPY capabilities/prediction/package.json capabilities/prediction/
COPY capabilities/reasoning/package.json capabilities/reasoning/
COPY capabilities/recall/package.json capabilities/recall/
RUN pnpm install --frozen-lockfile --prod --no-optional --ignore-scripts --filter @on.auto/server...
ARG TARGETARCH
RUN case "$TARGETARCH" in \
    amd64) kept=x64 ;; \
    arm64) kept=arm64 ;; \
    *) echo "TARGETARCH is amd64 or arm64, not $TARGETARCH" >&2 && exit 1 ;; \
  esac \
  && for binding in node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v*; do \
    find "$binding" -mindepth 1 -maxdepth 1 ! -name linux -exec rm -rf {} + \
    && find "$binding/linux" -mindepth 1 -maxdepth 1 ! -name "$kept" -exec rm -rf {} + ; \
  done
RUN --network=none npm_config_build_from_source=sqlite3 npm_config_nodedir=/usr/local \
  pnpm rebuild --filter @on.auto/server... sqlite3 \
  && find node_modules/.pnpm -path '*/node_modules/sqlite3/build/Release/*' -prune ! -name node_sqlite3.node \
    -exec rm -rf {} +
ARG AZURE_IDENTITY=false
RUN case "$AZURE_IDENTITY" in \
    true) pnpm install --frozen-lockfile --prod --ignore-scripts --filter @on.auto/reasoning ;; \
    false) ;; \
    *) echo "AZURE_IDENTITY is true or false, not $AZURE_IDENTITY" >&2 && exit 1 ;; \
  esac

FROM node:26.11.1-slim@sha256:193fe51b64e77981119c98c2002c9e32a70e2f006fb4d25068ce0558998917f0
LABEL org.opencontainers.image.licenses="Elastic-2.0"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5555 RUNTIME_DISTRIBUTION=docker
WORKDIR /app
COPY --from=dependencies /app ./
COPY LICENSE ./
COPY packages/server/container.vex.json packages/server/
COPY docs/concepts/terminology.md docs/concepts/
COPY docs/contributing/voice.md docs/contributing/
COPY docs/reference/*-format.md docs/reference/template.md docs/reference/
COPY packages/api/src packages/api/src
COPY packages/playbooks/src packages/playbooks/src
COPY packages/config/src packages/config/src
COPY packages/connections/src packages/connections/src
COPY packages/definitions/src packages/definitions/src
COPY packages/definitions/lib packages/definitions/lib
COPY packages/identity/src packages/identity/src
COPY packages/json-schema/src packages/json-schema/src
COPY packages/ledger/src packages/ledger/src
COPY packages/meter/src packages/meter/src
COPY packages/object-storage/src packages/object-storage/src
COPY packages/operations/src packages/operations/src
COPY packages/outbound/src packages/outbound/src
COPY packages/prediction-contract/src packages/prediction-contract/src
COPY packages/prediction-onnx/src packages/prediction-onnx/src
COPY packages/providers/src packages/providers/src
COPY packages/secrets/src packages/secrets/src
COPY packages/server/src packages/server/src
COPY packages/tool-servers/src packages/tool-servers/src
COPY packages/workflow-engine/src packages/workflow-engine/src
COPY packages/workflow-host/src packages/workflow-host/src
COPY capabilities/computation/src capabilities/computation/src
COPY capabilities/coordination/src capabilities/coordination/src
COPY capabilities/interaction/src capabilities/interaction/src
COPY capabilities/prediction/src capabilities/prediction/src
COPY capabilities/reasoning/src capabilities/reasoning/src
COPY capabilities/recall/src capabilities/recall/src
RUN apt-get update \
  && apt-get install --yes --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/* /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
  && install --directory --owner=node --group=node /data \
  && ln --symbolic /data /app/data
USER node
RUN prlimit --core=0 --data=805306368 node --input-type=module --eval "await import('/app/packages/prediction-onnx/src/sessions/model-sessions.ts')"
VOLUME /data
EXPOSE 5555
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "-e", "143", "--"]
CMD ["node", "packages/server/src/main.ts"]
