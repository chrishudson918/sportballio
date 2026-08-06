# Sportballio

A custom Stremio / Nuvio add-on built to stream live sports, schedule metadata, and sports streams directly into your favorite media player.

---

## 📌 Features

- **Live Sports Streams**: Live game events, match links, and sports streams.
- **Automated Metadata & Schedules**: Integrates match times, logos, and team details.
- **Docker Ready**: Pre-configured container setup for quick, isolated deployment on port `2323`.
- **Custom Port Mapping**: Built to run on port `2323` by default.

---

## 🛠️ Configuration & Environment Variables

Create a `.env` file in the root directory (or pass environment variables to Docker/your process manager):

```env
PORT=2323
HOST=0.0.0.0
```

---

## 🚀 Deployment Guide

### Option 1: Deployment with Docker Compose (Recommended)

1. **Start the service:**
   ```bash
   docker compose up -d
   ```
2. The add-on will be available at `http://<your-server-ip>:2323`.

---

### Option 2: Quick Deployment with Docker CLI

1. **Build the Docker image:**
   ```bash
   docker build -t sportballio .
   ```

2. **Run the container:**
   ```bash
   docker run -d \
     --name sportballio \
     --restart unless-stopped \
     -p 2323:2323 \
     -e PORT=2323 \
     sportballio
   ```

---

### Option 3: Manual Local Deployment (Node.js)

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the application:**
   ```bash
   PORT=2323 npm start
   ```

---

## 🌐 Reverse Proxy Setup (Nginx Proxy Manager)

If you are using Nginx Proxy Manager (or standard Nginx) with custom domain names:

1. **Forward Hostname / IP**: `172.17.0.1` (or your internal VPS IP)
2. **Forward Port**: `2323`
3. **Websockets Support**: Enable if streaming dynamic live updates.
4. **Manifest URL**: `http://your-domain.com/manifest.json`

---

## 🔗 Adding to Nuvio / Stremio

1. Open your Nuvio / Stremio client.
2. Go to **Add-ons** -> **Install from URL**.
3. Enter your manifest URL:
   ```text
   http://<your-server-ip>:2323/manifest.json
   ```
4. Click **Install**.
