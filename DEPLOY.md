# Deploy — Meesho LOD (buildathon)

This is a static site. The included `Dockerfile` packages it behind nginx on **:8080**
and serves `/`, `/u/`, and `/s/`. It's already been built and smoke-tested locally.

## Recommended: the buildathon skill (does everything, incl. the portal)

In an **interactive** Claude Code terminal (this handles Windows Docker/Rancher setup,
naming, the safety check, and the code backup for you):

```
/plugin marketplace add https://github.com/shatwik-pandey-meesho/hackathon-plugins
# then, after it syncs:
/hackathon-deploy my app
```

When prompted, paste:
- **Meesho email:** abhay.vatsa@meesho.com
- **Registry host:** registry.buildathon.meesho.dev
- **Username:** hackathon
- **Token / password:** buildathon-claude-2026-push-token

Then open **buildathon.ltl.sh** (or **buildathon.meesho.dev**), log in, and click
**Deploy Live**. Your live URL appears in ~1–2 min. If it doesn't, confirm you're logged
in, that the terminal said "Upload Succeeded", and click **Deploy Live** once more.

## Manual fallback (plain Docker, if you prefer)

```bash
# from the repo root (where the Dockerfile is)
docker build -t registry.buildathon.meesho.dev/hackathon/meesho-lod:latest .

echo "buildathon-claude-2026-push-token" | \
  docker login registry.buildathon.meesho.dev -u hackathon --password-stdin

docker push registry.buildathon.meesho.dev/hackathon/meesho-lod:latest
```

Then Deploy Live from the portal as above.

> Note: the exact image name/namespace the portal expects may differ — the
> `/hackathon-deploy` skill knows the convention, so prefer it. If the manual push is
> rejected, use the skill.

## What the judges see
- `/` — chooser (Live vs Field)
- `/u/#dashboard` — LOD Live (online, pink) — Ubhay
- `/s/#dashboard` — LOD Field (offline, indigo) — Sumit

Both auto-sign-in a demo Ubhay/admin profile, so every deep link works immediately.
