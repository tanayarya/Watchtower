# Watchtower

A private desktop-first home-server dashboard, served on port **8099**.

## Run locally

```sh
npm run dev
```

Open [http://localhost:8099](http://localhost:8099). No packages need to be installed.

## Deploy to the home server

```sh
docker compose up -d --build
```

Open `http://100.69.198.33:8099` from a device on your tailnet. The Compose port is bound only to that Tailnet address; update it if your Tailscale IP changes.

## Configure your apps and feeds

Edit [`config/dashboard.json`](config/dashboard.json):

- `services`: app URL, optional health URL, card name, category, and accent.
- `youtubeChannels`: use a YouTube channel ID and display name. The dashboard reads YouTube’s public RSS feed; no API key is required.
- `redditSubreddits`: public subreddits to show. The dashboard reads Reddit’s public JSON feed server-side.

The daily quote uses ZenQuotes’ public endpoint and falls back to a local quote if it is unavailable. Feed data is cached on the dashboard server and no feed credentials are stored in the browser.

## Next live integrations

The system chart intentionally uses design data until Beszel is connected. The service-status checks are live whenever Watchtower runs on the same network as the configured services. Add Home Assistant and Jellyfin tokens only through Docker secrets when their data widgets are added; never put them in the browser config.
