# Meesho LOD — static site image (robust for the buildathon k8s runtime).
#
# Handles all three unknowns of the platform at once:
#  1. non-root  → unprivileged nginx base
#  2. read-only rootfs → nginx.conf + generated server config live in /tmp
#     (tmpfs, writable even when the container FS is read-only)
#  3. unknown listen port → entrypoint listens on $PORT (Knative/Cloud-Run
#     injects it) PLUS common fixed ports (8080/3000/8000) as fallback.
FROM nginxinc/nginx-unprivileged:1.27-alpine

USER 0
COPY . /usr/share/nginx/html

# Minimal non-root main config: pid + temp paths under /tmp, include /tmp/mlod/*.conf
RUN printf '%s\n' \
  'worker_processes auto;' \
  'pid /tmp/nginx.pid;' \
  'events { worker_connections 1024; }' \
  'http {' \
  '  include /etc/nginx/mime.types;' \
  '  default_type application/octet-stream;' \
  '  client_body_temp_path /tmp/client_temp;' \
  '  proxy_temp_path /tmp/proxy_temp;' \
  '  fastcgi_temp_path /tmp/fastcgi_temp;' \
  '  uwsgi_temp_path /tmp/uwsgi_temp;' \
  '  scgi_temp_path /tmp/scgi_temp;' \
  '  sendfile on;' \
  '  keepalive_timeout 65;' \
  '  include /tmp/mlod/*.conf;' \
  '}' > /etc/nginx/nginx.conf && \
  printf '%s\n' \
  '#!/bin/sh' \
  'set -e' \
  'mkdir -p /tmp/mlod' \
  'PORTS="$(printf "%s\\n" ${PORT:-8080} 8080 3000 8000 | sort -un)"' \
  'LISTENS=""' \
  'for p in $PORTS; do LISTENS="$LISTENS  listen $p;\\n"; done' \
  '{' \
  '  echo "server {"' \
  '  printf "$LISTENS"' \
  '  echo "  server_name _;"' \
  '  echo "  root /usr/share/nginx/html;"' \
  '  echo "  index index.html;"' \
  '  echo "  location = / { try_files /index.html =404; }"' \
  '  echo "  location /u/ { try_files \$uri \$uri/ /u/index.html; }"' \
  '  echo "  location /s/ { try_files \$uri \$uri/ /s/index.html; }"' \
  '  echo "  location = /healthz { return 200; }"' \
  '  echo "  location / { try_files \$uri \$uri/ =404; }"' \
  '  echo "}"' \
  '} > /tmp/mlod/default.conf' \
  'exec nginx -c /etc/nginx/nginx.conf -g "daemon off;"' \
  > /start.sh && chmod +x /start.sh && \
  chown -R 101:0 /usr/share/nginx/html

USER 101
ENV PORT=8080
EXPOSE 8080 3000 8000
ENTRYPOINT ["/start.sh"]
