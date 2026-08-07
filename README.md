# Sportballio

An IPTV Xtream-powered Live Sports Add-on with a multi-step GUI configuration wizard built for Nuvio & Stremio.

---

## 🚀 Features & Workflow

1. **New User / Sign In GUI Workflow**:
   - Prompts for New User or Sign In with existing UUID.
   - Accepts Xtream IPTV server URL, username, and password without storing credentials globally.
   - Fetches live categories/folders directly from your IPTV provider.
   - Allows category selections for **NBA, NFL, MLB, NHL, WNBA**.
   - Multi-folder mapping per sport category.
   - Generates unique UUIDs and locks configurations behind password authentication.
   - Outputs tailored `manifest.json` links ready for Nuvio / Stremio.

---

## 🛠️ Deployment Instructions

### Docker Compose Deployment
```bash
docker compose up -d --build
```

Access the configurator GUI at:
`http://<your-vps-ip>:2323`
