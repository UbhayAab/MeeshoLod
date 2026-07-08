# Meesho LOD — static site image.
# Vanilla HTML/CSS/JS, no build step. Just serve the files.
FROM nginx:1.27-alpine

# App files → nginx web root
COPY . /usr/share/nginx/html

# SPA-friendly config: hash routing means index.html per directory is enough,
# but we also make /u and /s resolve, and disable HTML caching (fresh deploys).
RUN printf '%s\n' \
  'server {' \
  '  listen 8080;' \
  '  root /usr/share/nginx/html;' \
  '  index index.html;' \
  '  location = / { try_files /index.html =404; }' \
  '  location /u/ { try_files $uri $uri/ /u/index.html; }' \
  '  location /s/ { try_files $uri $uri/ /s/index.html; }' \
  '  location ~* \.(?:html)$ { add_header Cache-Control "no-cache, no-store, must-revalidate"; }' \
  '  location / { try_files $uri $uri/ =404; }' \
  '}' > /etc/nginx/conf.d/default.conf

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
