FROM postgres:17-alpine

WORKDIR /migrations

# Copy ALL migrations — the runner applies them in lexical order and
# tracks applied files in schema_migrations, so new files are picked up
# on every deploy without hardcoding file names in the image.
COPY backend/migrations/ /migrations/

RUN chmod 0755 /usr/local/bin/run-migrations.sh

ENTRYPOINT ["/usr/local/bin/run-migrations.sh"]
