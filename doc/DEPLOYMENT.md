# Deployment

## Process Manager

[pm2](https://pm2.keymetrics.io/docs/usage/quick-start/) can be used as a
process manager. It watches over the running server, writes logfiles and
restarts after crashes.

It can be installed globally with (might require root rights):

```bash
npm install -g pm2
```

Inside the pixelplanet folder, there is already a `ecoystem.yml` file, which
can be used to start pixelplanet with pm2:

```bash
pm2 start ecosystem.yml
```

And stop it with:

```bash
pm2 stop ecosystem.yml
```

> NOTE: On Windows you might have to prepend `npx`, like:
`npx pm2 start ecosystem.yml`


### Auto-Start

To have the canvas with all it's components autostart at systemstart,
enable mariadb, redis according to your system (`systemctl enable ...`), and then
setup pm2 startup with:

```
pm2 startup
```

(execute as the user that is running pixelplanet)
And follow the printed steps if needed. This will generate a systemctl service
file `/etc/systemd/system/pm2-pixelplanet.service` and enable it. You will have
to run `pm2 save` while the canvas is running to let pm2 know what to start.

To make sure that mariadb and redis are up when pixelplanet starts, edit this
service file and modify the lines:

```
Wants=network-online.target
After=network.target mariadb.service redis.service
```

### Logging

Logs from [pm2](https://pm2.keymetrics.io/docs/usage/quick-start/) are in
`~/pm2/log/`. You can watch them with:

```
pm2 log ppfun
```

you can flush the logs with

```
pm2 log flush
```

Pixel placing logs are in `./log/pixels.log`and proxycheck logs in
`./log/proxies.log` within the pixelplaent directory. They get rotated daily
and deleted if >14d old.

# Reverse Proxy / Server / nginx

Pixelplanet should be running behind [nginx](https://nginx.org/), which does
crucial tasks like handling SSL and rate limiting.

Set `USE\_XREALIP` to `yes` to make pixelplanet aware that it is behind a
reverse proxy, it will then take the IP of the User from the `X-Real-Ip`
header, which you have to configure in *nginx* to be set to the ip of the user.

You also need `X-Forwarded-Proto` and `X-Forwarded-Host`. So in every single
location directive inside the *nginx* config, do:

```nginx
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-Proto $proxy_x_forwarded_proto;
  proxy_set_header X-Forwarded-Host $host;
```

A baic configuration can look like this (note how the ssl certificates are ):

```nginx
server {
  listen 80;
  listen [::]:80;

  server_name example.com;

  listen 443 ssl http2;
  listen [::]:443 ssl http2;

  ssl_certificate /etc/ssl/certs/ssl-cert-snakeoil.pem;
  ssl_certificate_key /etc/ssl/private/ssl-cert-snakeoil.key;

  location / {
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $proxy_x_forwarded_proto;
    proxy_set_header X-Forwarded-Host $host;

    proxy_pass http://127.0.0.1:5000$request_uri;
  }
}
```

If you use a CDN like cloudflare, you also need to setup the real-ip module to
trust theirs IPs. How to do this, will not be documented here.

# Cloudflare

When using Cloudflare (you souldn't), its Caching Setting `Broser Cache Expiration` should be set to `Respect Existing Headers` or it would default to 4h, which is unreasonable for chunks.

# Cluster

Pixelplanet can run in multiple processes ("shards") to distribute load. This
is important on high load with many users, because nodejs is notoriously single-
core intensive.

1. Set `IS_CLUSTER` to `true` in `config.ini`.

2. Write an `ecosystem.yml` that launches multiple pixelplanet processes with
different ports

```yml
apps:
  - script     : ./server.js
    name       : 'ppfun1'
    node_args  : --nouse-idle-notification --expose-gc
    env:
      PORT: 3334
  - script     : ./server.js
    name       : 'ppfun2'
    node_args  : --nouse-idle-notification --expose-gc
    env:
      PORT: 3335
  - script     : ./server.js
    name       : 'ppfun3'
    node_args  : --nouse-idle-notification --expose-gc
    env:
      PORT: 3336
  - script     : ./server.js
    name       : 'ppfun4'
    node_args  : --nouse-idle-notification --expose-gc
    env:
      PORT: 3337
  - script     : ./server.js
    name       : 'ppfun5'
    node_args  : --nouse-idle-notification --expose-gc
    env:
      PORT: 3338
  - script     : ./server.js
    name       : 'ppfun6'
    node_args  : --nouse-idle-notification --expose-gc
    env:
      PORT: 3339

```

3. Make nginx load balance between those:

```nginx
upstream ppfun_backend {
  server 127.0.0.1:3334;
  server 127.0.0.1:3335;
  server 127.0.0.1:3336;
  server 127.0.0.1:3337;
  server 127.0.0.1:3338;
  server 127.0.0.1:3339;
}

server {
  listen 80;
  listen [::]:80;

  server_name example.com;

  listen 443 ssl http2;
  listen [::]:443 ssl http2;

  ssl_certificate /etc/ssl/certs/ssl-cert-snakeoil.pem;
  ssl_certificate_key /etc/ssl/private/ssl-cert-snakeoil.key;

  location / {
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $proxy_x_forwarded_proto;
    proxy_set_header X-Forwarded-Host $host;

    proxy_pass http://ppfun_backend$request_uri;
  }
}
```
