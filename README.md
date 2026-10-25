# Horizon (web build)

Minecraft Java Edition, written in Rust, running in the browser on WebGPU.

## Play

Once GitHub Pages has deployed: https://elliott964.github.io/horizon-web/

Requires a WebGPU-capable browser: Chrome/Edge 113+, Firefox 141+ on Windows, or Safari 26+.

## Deploying

Resources are stored compressed (`res.idx.gz`, `res.pack.gz`) because `res.pack` is
larger than GitHub's per-file limit. The workflow in `.github/workflows/deploy.yml`
decompresses them and publishes the directory to GitHub Pages on every push to `main`.

## Running locally

```sh
gunzip -k res.idx.gz res.pack.gz
npx serve .
```

Then open the printed localhost URL. `localhost` counts as a secure context, so WebGPU works.
