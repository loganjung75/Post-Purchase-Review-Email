# Ascendica Review Mailer

Automated post-purchase review email system. Listens for Stripe `checkout.session.completed` events and sends a branded review request email 7 days later via your Hostinger SMTP.

---

## How it works

```
Stripe checkout → Webhook → App stores job → Cron checks hourly → Sends email at day 7
```

---

## Deploy to Render (100% free)

### 1. Push to GitHub
Upload the project folder to a new GitHub repo (see above for how).

### 2. Create Render account & deploy
1. Go to [render.com](https://render.com) → sign up free with GitHub
2. Click **New** → **Web Service**
3. Connect your `ascendica-review-mailer` GitHub repo
4. Render auto-detects the `render.yaml` — confirm settings and click **Deploy**

### 3. Add a Disk (so the database persists)
1. In Render dashboard → your service → **Disks**
2. Add disk, mount path: `/app/data`, size: 1GB (free)

### 4. Set environment variables
In Render → your service → **Environment**, add:

| Variable | Value |
|---|---|
| `STRIPE_WEBHOOK_SECRET` | From Stripe dashboard (step 5) |
| `STRIPE_SECRET_KEY` | Your Stripe secret key (`sk_live_...`) |
| `SMTP_USER` | `info@drinkascendica.com` |
| `SMTP_PASS` | Your Hostinger email password |

(The rest are pre-filled in render.yaml)

### 5. Point Stripe webhook to Render
1. Get your Render URL from the dashboard (e.g. `https://ascendica-review-mailer.onrender.com`)
2. Go to [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks)
3. **Add endpoint**: `https://ascendica-review-mailer.onrender.com/webhook/stripe`
4. Select event: `checkout.session.completed`
5. Copy the **Signing secret** → paste as `STRIPE_WEBHOOK_SECRET` in Render

---

## Optional: Pass product name from Stripe

In your Stripe checkout session creation, add metadata:
```js
metadata: {
  product_name: "Ascendica Energy Blend"
}
```
If not set, the email defaults to "your recent order".

---

## Verify it's working

Visit `https://YOUR-RAILWAY-URL.up.railway.app/health` — you'll see:
```json
{
  "status": "ok",
  "pending_jobs": 0,
  "emails_sent": 0,
  "delay_days": 7
}
```

After a test purchase, `pending_jobs` will increment. After 7 days, `emails_sent` will increment.

---

## Hostinger SMTP settings
- Host: `smtp.hostinger.com`
- Port: `465` (SSL) or `587` (TLS)
- Username: your full email `info@drinkascendica.com`
- Password: your Hostinger email account password

> Find these in Hostinger hPanel → Email → Email Accounts → Manage → Configuration
