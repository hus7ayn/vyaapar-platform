# Deploy on Oracle Cloud Always Free

One VM runs everything (web + API + Postgres) for **3 shops at $0/month**.

---

## Part A — Create the VM (Oracle Console)

### 1. Sign up
- Go to [https://www.oracle.com/cloud/free/](https://www.oracle.com/cloud/free/)
- Create account (credit card required; stay on **Always Free** resources)

### 2. Create a VM
1. **Menu → Compute → Instances → Create instance**
2. **Name:** `vyaapar`
3. **Image:** Ubuntu 22.04 (aarch64)
4. **Shape:** `VM.Standard.A1.Flex` (Ampere — Always Free)
   - **1 OCPU**, **6 GB RAM** (enough for Docker build + run)
5. **Networking:** use default VCN
6. **SSH keys:** download private key or paste your public key
7. **Create**

### 3. Open firewall (required!)
1. **Networking → Virtual cloud networks → your VCN → Security Lists → Default**
2. **Add Ingress Rules:**
   | Source | Port | Description |
   |--------|------|-------------|
   | `0.0.0.0/0` | TCP 22 | SSH |
   | `0.0.0.0/0` | TCP 80 | HTTP (app) |
   | `0.0.0.0/0` | TCP 443 | HTTPS (optional, for SSL later) |

3. On the instance page, copy the **Public IP address**

### 4. (Ubuntu) Open OS firewall
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save 2>/dev/null || true
```

---

## Part B — Install on the VM

### 1. SSH in
```bash
chmod 400 your-key.pem
ssh -i your-key.pem ubuntu@YOUR_PUBLIC_IP
```

### 2. Upload the project

**Option A — Git (if repo is on GitHub):**
```bash
sudo apt update && sudo apt install -y git
git clone https://github.com/YOUR_USER/YOUR_REPO.git vyaapar
cd vyaapar
```

**Option B — Copy from your Mac:**
```bash
# On your Mac (from project folder):
scp -i your-key.pem -r "/Users/hussain/nill3 copy 2" ubuntu@YOUR_PUBLIC_IP:~/vyaapar
# Then on VM:
cd ~/vyaapar
```

### 3. Run installer
```bash
cd ~/vyaapar
chmod +x deploy/oracle/*.sh
bash deploy/oracle/install.sh
```

The script will:
- Install Docker
- Create `.env` with your public IP + random secrets
- Build and start all containers
- Run database seed (demo login)

### 4. Open in browser
```
http://YOUR_PUBLIC_IP
```

| | |
|--|--|
| Login | `admin@grandplaza.demo` / `Demo@123456` |
| POS | `http://YOUR_PUBLIC_IP/pos` |

**Change the admin password after first login.**

---

## Part C — Optional: custom domain + free SSL

1. Buy domain or use existing
2. **Cloudflare** (free): add A record → `YOUR_PUBLIC_IP`, enable proxy (orange cloud)
3. Update `.env`:
   ```env
   PUBLIC_URL=https://billing.yourdomain.com
   CORS_ORIGIN=https://billing.yourdomain.com
   WEB_URL=https://billing.yourdomain.com
   API_URL=https://billing.yourdomain.com
   ```
4. Rebuild web (API URL is baked in at build time):
   ```bash
   docker compose -f docker-compose.prod.yml build web --no-cache
   docker compose -f docker-compose.prod.yml up -d
   ```

---

## Maintenance

```bash
cd ~/vyaapar

# View logs
docker compose -f docker-compose.prod.yml logs -f api web

# Restart
docker compose -f docker-compose.prod.yml restart

# Update after code changes
git pull
docker compose -f docker-compose.prod.yml up -d --build

# Backup database
bash deploy/oracle/backup.sh

# Cron backup (daily 2am)
(crontab -l 2>/dev/null; echo "0 2 * * * $HOME/vyaapar/deploy/oracle/backup.sh") | crontab -
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Can't open site in browser | Check Oracle Security List port 80 + Ubuntu iptables |
| Login "Failed to fetch" | `PUBLIC_URL` in `.env` must match browser URL; rebuild `web` |
| Build runs out of memory | Use 6 GB RAM shape; add swap: `sudo fallocate -l 2G /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile` |
| API won't start | `docker compose -f docker-compose.prod.yml logs api` |

---

## Cost

**$0/month** on Oracle Always Free (1× A1.Flex VM, 200 GB storage).
