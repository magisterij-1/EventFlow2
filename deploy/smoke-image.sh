#!/usr/bin/env bash
set -euo pipefail

image=${1:?Production image tag required}
network="eventflow-smoke-$$"
database="$network-db"
app="$network-app"
database_password=$(openssl rand -hex 16)

cleanup() {
  if [[ "$?" != 0 ]]; then
    docker logs "$database" >&2 || true
    docker logs "$app" >&2 || true
  fi
  docker rm -fv "$app" "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$network" >/dev/null
docker run --detach --name "$database" --network "$network" \
  --env "POSTGRES_PASSWORD=$database_password" --env POSTGRES_DB=eventflow postgres:17 >/dev/null

for attempt in {1..30}; do
  if docker exec "$database" pg_isready -h 127.0.0.1 -U postgres -d eventflow; then
    break
  fi
  if [[ "$attempt" == 30 ]]; then exit 1; fi
  sleep 1
done

docker run --detach --name "$app" --network "$network" --publish 127.0.0.1::3000 \
  --env "DATABASE_URL=postgresql://postgres:$database_password@$database/eventflow" "$image" >/dev/null

url="http://$(docker port "$app" 3000/tcp)"
curl --fail --silent --show-error --max-time 3 --retry 15 --retry-all-errors --retry-delay 2 \
  "$url/" | grep 'id="root"'
curl --fail --silent --show-error "$url/api/events" | grep -Fx '{"events":[]}'
docker exec "$database" psql -U postgres -d eventflow -Atc 'SELECT count(*) FROM categories' | grep -Fx 5
