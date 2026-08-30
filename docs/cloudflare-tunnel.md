## Purpose

This document describes the named Cloudflare Tunnel used to expose a local
HQBase Worker process. It contains no account credentials or tunnel secrets.

The connection path is:

```text
Client → Cloudflare edge → hqbase-amber Tunnel → cloudflared on amber → HQBase HTTP origin
```

Cloudflare Workers, D1, and R2 remain Cloudflare services. The Tunnel is only
the public path to the HQBase process running on the amber network.

## Prerequisites

- An active Cloudflare zone for `do.luciia.net`.
- A Cloudflare account with permission to create Tunnels and DNS records.
- `cloudflared` installed on amber.
- The HQBase process listening on a reachable local HTTP address.

Do not use a quick Tunnel. Its hostname changes after a restart.

## Create the named Tunnel

Run these commands on amber after authenticating with the target Cloudflare
account:

```sh
cloudflared tunnel login
cloudflared tunnel create hqbase-amber
cloudflared tunnel list
```

The create command writes a credentials file under `~/.cloudflared/`. Keep
this file on amber only and set its mode to `0600`:

```sh
chmod 600 ~/.cloudflared/<TUNNEL_UUID>.json
```

Create `~/.cloudflared/config.yml` with the tunnel UUID and credentials path.
Use an HTTP origin. Replace `<INTERNAL_IP>` and `<PORT>` with the address of
the running HQBase process.

```yaml
tunnel: <TUNNEL_UUID>
credentials-file: /home/amber/.cloudflared/<TUNNEL_UUID>.json

ingress:
  - hostname: do.luciia.net
    service: http://<INTERNAL_IP>:<PORT>
  - hostname: '*.do.luciia.net'
    service: http://<INTERNAL_IP>:<PORT>
  - service: http_status:404
```

The same rules are available in
`.hqbase/deployments/production/tunnel.example.yml`.

## Route DNS and run the Tunnel

Create DNS routes for the hostnames after the zone is active:

```sh
cloudflared tunnel route dns hqbase-amber do.luciia.net
cloudflared tunnel route dns hqbase-amber '*.do.luciia.net'
```

Check the local origin before starting the Tunnel. The default local HQBase
development server uses port `8787`:

```sh
curl -H 'Host: do.luciia.net' http://127.0.0.1:<PORT>
cloudflared tunnel ingress validate ~/.cloudflared/config.yml
cloudflared tunnel info hqbase-amber
cloudflared tunnel run --config ~/.cloudflared/config.yml hqbase-amber
```

For a long-running user service, use a user systemd unit. It must read the
config and credentials owned by the amber user. Store logs in the user journal:

```sh
mkdir -p ~/.config/systemd/user
systemctl --user daemon-reload
systemctl --user enable --now cloudflared-hqbase.service
journalctl --user -u cloudflared-hqbase.service -f
```

The unit should run this command:

```text
cloudflared tunnel --config /home/amber/.cloudflared/config.yml run hqbase-amber
```

Verify the connection with:

```sh
cloudflared tunnel info hqbase-amber
curl -fsS https://do.luciia.net/
```

`cloudflared tunnel info` must show at least one healthy connector. Do not
publish its token, credentials path contents, or private origin address.

## Credential rotation

1. Create a replacement Tunnel token or credential with the minimum required
   permissions.
2. Stop the local service.
3. Replace the credentials file on amber and set mode `0600`.
4. Update `credentials-file` if the UUID changed.
5. Start the service and confirm a healthy connector.
6. Revoke the old token or credential in Cloudflare.

Never commit `~/.cloudflared/*.json`, `~/.cloudflared/config.yml`, or service
logs to this repository. Logs must not contain credentials or mail content.

## Important origin rule

Use `http://` for the HQBase origin in the Tunnel ingress. The Tunnel connects
to an HTTP service. Do not use `https://` unless the local origin is explicitly
configured for TLS and its certificate is trusted by `cloudflared`; a normal
HQBase local Worker uses plain HTTP. A raw TCP origin is not valid for this
HTTP hostname routing setup.
