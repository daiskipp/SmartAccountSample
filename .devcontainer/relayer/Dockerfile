FROM openzeppelin/openzeppelin-relayer:1.8.0

USER root
WORKDIR /app/plugins/channels
COPY package.json index.ts patch-channels.cjs ./
RUN npm install --omit=dev --no-package-lock \
    && node patch-channels.cjs \
    && chown -R nonroot:nonroot /app/plugins/channels

COPY --chown=nonroot:nonroot config /app/config
COPY --chown=nonroot:nonroot bootstrap.mjs /app/account-sample-relayer-bootstrap.mjs
COPY entrypoint.sh init-secrets.sh /app/
RUN chmod 0555 /app/entrypoint.sh /app/init-secrets.sh

USER nonroot
WORKDIR /app
ENTRYPOINT ["/app/entrypoint.sh"]
