FROM postgres:17-alpine

WORKDIR /migrations

COPY backend/migrations/20260712_01_user_administration.sql /migrations/20260712_01_user_administration.sql
COPY infra/docker/db-migrate/run-migrations.sh /usr/local/bin/run-migrations.sh

RUN chmod 0755 /usr/local/bin/run-migrations.sh

ENTRYPOINT ["/usr/local/bin/run-migrations.sh"]
