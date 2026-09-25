# syntax=docker/dockerfile:1

# A static site: no build step, just nginx serving the files.
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html config.js manifest.webmanifest /usr/share/nginx/html/
COPY assets /usr/share/nginx/html/assets

EXPOSE 80
# nginx listens on IPv4 only, and "localhost" resolves to ::1 in this image.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
