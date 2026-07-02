# Deploy on Google Cloud — Always Free ($0)

Use this if **Oracle signup won't let you continue**. Same app, same `install.sh`.

**Cost:** $0/month (e2-micro VM in eligible regions)

---

## Part A — Create GCP account & VM

### 1. Sign up
1. Go to [https://cloud.google.com/free](https://cloud.google.com/free)
2. Sign in with Gmail → Start free
3. Add card (verification only; e2-micro stays free in listed regions)

### 2. Create VM
1. **Console → Compute Engine → VM instances → Create instance**
2. Settings:

| Field | Value |
|-------|--------|
| Name | `vyaapar` |
| Region | `us-west1` (Oregon) or `us-central1` — **free tier eligible** |
| Machine type | `e2-micro` (0.25 vCPU, 1 GB) — free |
| Boot disk | Ubuntu 22.04 LTS, **30 GB** |
| Firewall | ✅ Allow HTTP traffic, ✅ Allow HTTPS traffic |

3. **Create**

### 3. Add swap (1 GB RAM is tight for Docker build)
After SSH (step below), run once:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## Part B — Install the app

### 1. SSH in
Console → VM → **SSH** button (opens browser terminal)

Or from Mac:
```bash
gcloud compute ssh vyaapar --zone=YOUR_ZONE
```

### 2. Upload project

**From your Mac:**
```bash
# Install gcloud CLI first if needed: https://cloud.google.com/sdk/docs/install
gcloud compute scp --recurse "/Users/hussain/nill3 copy 2" vyaapar:~/vyaapar --zone=YOUR_ZONE
```

**Or on VM with git:**
```bash
sudo apt update && sudo apt install -y git
git clone YOUR_REPO_URL vyaapar
cd vyaapar
```

### 3. Run installer
```bash
cd ~/vyaapar
chmod +x deploy/oracle/install.sh deploy/oracle/backup.sh
bash deploy/oracle/install.sh
```

Wait **15–25 minutes** (build is slow on e2-micro).

### 4. Open app
GCP console → VM → copy **External IP**:
```
http://YOUR_EXTERNAL_IP
```

Login: `admin@grandplaza.demo` / `Demo@123456`

---

## Firewall (if site doesn't load)

GCP usually opens 80 when you checked "Allow HTTP traffic". If not:

1. **VPC network → Firewall → Create rule**
2. Target: All instances, Source `0.0.0.0/0`, TCP **80, 443**

---

## Optional: free domain + SSL

1. [Cloudflare](https://cloudflare.com) — add site, point A record to VM IP
2. Edit `~/vyaapar/.env`:
   ```env
   PUBLIC_URL=https://yourdomain.com
   CORS_ORIGIN=https://yourdomain.com
   WEB_URL=https://yourdomain.com
   ```
3. Rebuild web:
   ```bash
   cd ~/vyaapar
   docker compose -f docker-compose.prod.yml build web --no-cache
   docker compose -f docker-compose.prod.yml up -d
   ```

---

## Maintenance

```bash
cd ~/vyaapar
docker compose -f docker-compose.prod.yml logs -f api
bash deploy/oracle/backup.sh   # DB backup
```

---

## GCP vs Oracle

| | GCP e2-micro | Oracle A1 |
|--|--------------|-----------|
| Signup | Usually easier | Often blocked |
| RAM | 1 GB (+ add swap) | 6 GB if you get A1 |
| Cost | $0 in free regions | $0 |
| Good for 3 shops | ✅ Yes | ✅ Yes |
