require("dotenv").config();
const express = require("express");
const nodemailer = require("nodemailer");
const cron = require("node-cron");
const { Pool } = require("pg");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const DELAY_DAYS = parseInt(process.env.DELAY_DAYS || "7");

// ── Neon Postgres ─────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_jobs (
      id            TEXT PRIMARY KEY,
      customer_email TEXT NOT NULL,
      customer_name  TEXT NOT NULL,
      product_name   TEXT NOT NULL,
      order_id       TEXT NOT NULL,
      send_at        BIGINT NOT NULL,
      sent           BOOLEAN DEFAULT FALSE,
      created_at     BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
    );
  `);
  console.log("✅ Database ready");
}

// ── Nodemailer transporter (Hostinger SMTP) ───────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.hostinger.com",
  port: parseInt(process.env.SMTP_PORT || "465"),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ── Email HTML template ───────────────────────────────────────────────────────
function buildEmailHTML(customerName, productName) {
  const firstName = customerName.split(" ")[0] || customerName;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>How was your experience?</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600&family=Jost:wght@300;400;500&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background-color:#f5f2ed; font-family:'Jost',sans-serif; color:#1a1a1a; }
    .wrapper { max-width:580px; margin:40px auto; background:#ffffff; border-top:3px solid #2b5e3a; }
    .header { background:#0d2618; padding:40px 48px 32px; text-align:center; }
    .logo { font-family:'Cormorant Garamond',serif; font-size:26px; font-weight:600; letter-spacing:0.12em; color:#c9e8d1; text-transform:uppercase; }
    .logo span { color:#6fcf8e; }
    .body { padding:48px 48px 40px; }
    .greeting { font-family:'Cormorant Garamond',serif; font-size:32px; font-weight:600; color:#0d2618; line-height:1.2; margin-bottom:24px; }
    .body p { font-size:15px; line-height:1.75; color:#444; font-weight:300; margin-bottom:16px; }
    .product-pill { display:inline-block; background:#eaf5ee; border:1px solid #b2d9be; color:#1e5c30; font-size:13px; font-weight:500; letter-spacing:0.06em; text-transform:uppercase; padding:6px 14px; border-radius:100px; margin-bottom:32px; }
    .cta-wrap { text-align:center; margin:36px 0; }
    .cta-btn { display:inline-block; background:#2b5e3a; color:#ffffff !important; text-decoration:none; font-family:'Jost',sans-serif; font-size:14px; font-weight:500; letter-spacing:0.1em; text-transform:uppercase; padding:16px 40px; border-radius:2px; }
    .divider { border:none; border-top:1px solid #e8e3dc; margin:36px 0; }
    .footer { background:#f5f2ed; padding:28px 48px; text-align:center; font-size:12px; color:#999; font-weight:300; line-height:1.8; }
    .footer a { color:#2b5e3a; text-decoration:none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="logo">Drink <span>Ascendica</span></div>
    </div>
    <div class="body">
      <div class="greeting">How's it going, ${firstName}?</div>
      <div class="product-pill">${productName}</div>
      <p>It's been a week since your order arrived, and we'd love to hear what you think. Your honest feedback helps other customers make confident choices — and it helps us keep improving.</p>
      <p>It only takes a minute, and it means the world to a small brand like ours.</p>
      <div class="cta-wrap">
        <a href="https://drinkascendica.com/leave-a-review" class="cta-btn">Leave Your Review →</a>
      </div>
      <hr class="divider" />
      <p style="font-size:13px;color:#888;">If you have any questions or issues with your order, just reply to this email — we're always happy to help.</p>
    </div>
    <div class="footer">
      © ${new Date().getFullYear()} Drink Ascendica. All rights reserved.<br/>
      <a href="https://drinkascendica.com">drinkascendica.com</a>
    </div>
  </div>
</body>
</html>`;
}

// ── Send email ────────────────────────────────────────────────────────────────
async function sendReviewEmail(job) {
  const html = buildEmailHTML(job.customer_name, job.product_name);
  await transporter.sendMail({
    from: `"Drink Ascendica" <${process.env.SMTP_USER}>`,
    to: job.customer_email,
    subject: `How did you like your ${job.product_name}? 🌿`,
    html,
  });
  console.log(`✅ Review email sent to ${job.customer_email} (order: ${job.order_id})`);
}

// ── Cron: check for due jobs every hour ──────────────────────────────────────
cron.schedule("0 * * * *", async () => {
  const now = Math.floor(Date.now() / 1000);
  const { rows } = await pool.query(
    "SELECT * FROM email_jobs WHERE sent = FALSE AND send_at <= $1",
    [now]
  );
  for (const job of rows) {
    try {
      await sendReviewEmail(job);
      await pool.query("UPDATE email_jobs SET sent = TRUE WHERE id = $1", [job.id]);
    } catch (err) {
      console.error(`❌ Failed to send to ${job.customer_email}:`, err.message);
    }
  }
});

// ── Stripe webhook ────────────────────────────────────────────────────────────
app.post(
  "/webhook/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;
    try {
      const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error("⚠️  Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const customerEmail = session.customer_details?.email || session.customer_email;
      const customerName  = session.customer_details?.name || "Valued Customer";
      const productName   = session.metadata?.product_name || "your recent order";
      const orderId       = session.id;

      if (!customerEmail) {
        console.warn("⚠️  No customer email found in session:", orderId);
        return res.json({ received: true });
      }

      const sendAt = Math.floor(Date.now() / 1000) + DELAY_DAYS * 86400;
      const jobId  = crypto.randomUUID();

      await pool.query(
        `INSERT INTO email_jobs (id, customer_email, customer_name, product_name, order_id, send_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [jobId, customerEmail, customerName, productName, orderId, sendAt]
      );

      console.log(`📅 Scheduled review email for ${customerEmail} in ${DELAY_DAYS} days`);
    }

    res.json({ received: true });
  }
);

// ── Health check ──────────────────────────────────────────────────────────────
app.use(express.json());
app.get("/health", async (req, res) => {
  const { rows: [pending] } = await pool.query("SELECT COUNT(*) FROM email_jobs WHERE sent = FALSE");
  const { rows: [sent] }    = await pool.query("SELECT COUNT(*) FROM email_jobs WHERE sent = TRUE");
  res.json({
    status: "ok",
    pending_jobs: parseInt(pending.count),
    emails_sent:  parseInt(sent.count),
    delay_days:   DELAY_DAYS,
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Ascendica Review Mailer running on port ${PORT}`);
    console.log(`📬 Webhook: POST /webhook/stripe`);
    console.log(`💚 Health:  GET  /health`);
    console.log(`⏰ Delay:   ${DELAY_DAYS} days`);
  });
});
