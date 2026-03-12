# WebCards

WebCards is a browser-based collectible card game with account login, card packs, 7-card hands, missions, PvP judging, direct trading, and admin tools.

## Features implemented

- Username/password registration and login (session-based)
- Starter cards on account creation
- Collection view + set 7-card hand
- Pack opening (7 cards each): free, points, bonus
- Tiered rarity (0-7) with guaranteed tier 3-4+ card in each pack
- Codeword-biased pack pulls (theme packs)
- Luck boost consumable charges for better odds
- Single-player missions (1-hour cooldown, admin bypass)
- PvP queue (auto-match + AI-style scoring fallback)
- Direct player-to-player trade proposals and accept/decline
- User card submissions queue
- Admin panel for creating/approving cards

## Stack

- Node.js + Express
- SQLite (`better-sqlite3`)
- Vanilla HTML/CSS/JS frontend

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Environment variables

- `PORT` (default `3000`)
- `SESSION_SECRET` (change this in production)
- `ADMIN_SECRET` (used at login to grant admin)

Example:

```bash
PORT=8080 SESSION_SECRET='super-long-random' ADMIN_SECRET='my-admin-secret' npm start
```

## Linux server + static IP/domain setup

1. Run app on your chosen open port (example `8080`).
2. Point your server static IP / DNS A record to your server.
3. Put Nginx in front and proxy traffic:

```nginx
server {
  listen 80;
  server_name your-domain.com;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

4. Use `systemd`/`pm2` to keep Node running.
5. Add HTTPS via Let's Encrypt.

## Notes

- Card images can be hosted externally or stored in `/assets` and referenced as `/assets/file.png`.
- Judging currently uses a local scoring fallback; wire in your OpenAI key in server logic when ready.
