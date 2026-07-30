# V. Gallery — Setup Guide

A gallery + e-commerce site with three payment paths: **Paystack**, **Flutterwave**,
and **direct bank / domiciliary transfer**. Products, orders, and stock live in a
real database (Supabase). All money-related logic — computing prices, verifying
payments, and confirming orders — happens server-side; the browser is never
trusted with anything that affects a price or an order's paid status.

Follow the steps in order. Steps 1–4 get the backend working; step 5 gets you
live payments; step 6 deploys it.

---

## 1. Create your Supabase project

1. Go to [supabase.com](https://supabase.com) → sign up → **New project**.
2. Once it's created, go to **SQL Editor** → **New query**.
3. Open `supabase/migrations/001_complete_schema.sql` from this project, paste
   its entire contents in, and click **Run**. You should see
   `✅ Schema v2 complete...` at the bottom.
4. Go to **Project Settings → API**. Copy two values — you'll need them shortly:
   - **Project URL** → this is `VITE_SUPABASE_URL`
   - **service_role secret** (NOT the `anon` key) → this is `SUPABASE_SERVICE_ROLE_KEY`

   The service role key is powerful — it bypasses all database security rules.
   It must **only** ever live in Netlify's server-side environment variables,
   never in any file that ships to the browser. Nothing in this project puts
   it there — just make sure you don't paste it anywhere else later.

## 2. Set your admin password

The admin login refuses to work at all until this is set — there is no
default password and no "demo mode."

1. Pick a strong password.
2. Generate its bcrypt hash. If you have Node.js installed locally:
   ```bash
   npm install
   npm run hash-password -- "your-chosen-password"
   ```
   This prints a hash starting with `$2a$10$...` — copy the whole thing.
3. You'll paste this into Netlify as `ADMIN_PASSWORD_HASH` in step 6.

Keep the plaintext password somewhere safe (a password manager) — only the
hash goes into the app, and hashes can't be reversed back into the password.

## 3. Set up Paystack

1. Create an account at [paystack.com](https://paystack.com).
2. **Settings → API Keys & Webhooks**. Copy your **Public Key** and **Secret
   Key** (use the Test keys first — switch to Live keys once you've tested
   an end-to-end order).
3. In the same page, under **Webhooks**, set the webhook URL to:
   ```
   https://YOUR-SITE.netlify.app/.netlify/functions/paystack-webhook
   ```
   (You'll fill in your real domain once it's deployed in step 6 — you can
   come back and set this afterward.)
   Paystack signs webhook calls using your Secret Key automatically — there's
   no separate webhook secret to configure on their side.

## 4. Set up Flutterwave

1. Create an account at [flutterwave.com](https://flutterwave.com).
2. **Settings → API** (Dashboard). Copy your **Public Key** and **Secret Key**
   (start with Test mode keys).
3. **Settings → Webhooks**. Set:
   - **URL**: `https://YOUR-SITE.netlify.app/.netlify/functions/flutterwave-webhook`
   - **Secret Hash**: make up a long random string (e.g. generate one at
     [random.org](https://www.random.org/strings/) or run
     `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`)
     and paste it here. You'll use this exact same string as
     `FLUTTERWAVE_WEBHOOK_SECRET_HASH` in step 6 — Flutterwave sends it back
     on every webhook call so the function can confirm the call really came
     from them.

## 5. Set up your bank / domiciliary details

No account creation needed here — this is just informational text shown to
customers who choose "Direct Bank / Domiciliary Transfer" at checkout. Have
ready:

- **Local (NGN) account**: bank name, account number, account name
- **Domiciliary (USD) account**: bank name, account number, account name,
  SWIFT code

Orders paid this way stay **pending** until you personally check your bank
statement and click **Confirm Payment** next to that order in the admin
dashboard — there's no automatic verification for bank transfers, since
there's no API to check against. Nothing about stock or "paid" status changes
until you do that.

## 6. Deploy to Netlify

1. Push this project to a GitHub repository.
2. In [Netlify](https://app.netlify.com), **Add new site → Import an existing
   project**, and connect that repository. Netlify will read `netlify.toml`
   automatically (publish dir `public`, functions dir `netlify/functions`).
3. Before the first deploy finishes mattering, go to **Site configuration →
   Environment variables** and add every one of these (see `.env.example`
   for the full annotated list):

   | Variable | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | from step 1 |
   | `SUPABASE_SERVICE_ROLE_KEY` | from step 1 |
   | `SITE_URL` | `https://your-actual-site-name.netlify.app` |
   | `ADMIN_PASSWORD_HASH` | from step 2 |
   | `PAYSTACK_PUBLIC_KEY` | from step 3 |
   | `PAYSTACK_SECRET_KEY` | from step 3 |
   | `FLUTTERWAVE_PUBLIC_KEY` | from step 4 |
   | `FLUTTERWAVE_SECRET_KEY` | from step 4 |
   | `FLUTTERWAVE_WEBHOOK_SECRET_HASH` | from step 4 |
   | `BANK_LOCAL_NAME` / `BANK_LOCAL_ACCOUNT_NUMBER` / `BANK_LOCAL_ACCOUNT_NAME` | from step 5 |
   | `BANK_DOM_NAME` / `BANK_DOM_ACCOUNT_NUMBER` / `BANK_DOM_ACCOUNT_NAME` / `BANK_DOM_SWIFT_CODE` | from step 5 |
   | `WHATSAPP_NUMBER` | your number, country code + digits only, e.g. `2348012345678` |

4. Trigger a deploy (**Deploys → Trigger deploy → Deploy site**) so the
   functions pick up the new environment variables.
5. Now go back to Paystack and Flutterwave's webhook settings (steps 3–4)
   and paste in your real `https://your-site.netlify.app/.netlify/functions/...`
   webhook URLs if you hadn't already.

## 7. Test it end-to-end (in test mode)

1. Visit your live site, enter the gallery, add something to cart.
2. Try each payment path:
   - **Paystack** (test mode): use Paystack's [test
     cards](https://paystack.com/docs/payments/test-payments/) — you'll be
     redirected to `payment-callback.html`, which should say "Payment
     confirmed."
   - **Flutterwave** (test mode): use Flutterwave's [test
     cards](https://developer.flutterwave.com/docs/integration-guides/testing-helpers) —
     same redirect flow.
   - **Bank transfer**: you'll see the bank details panel appear inline —
     confirm it shows your real account details, then go to `/admin`, log
     in, open **Orders**, and click **Confirm Payment** on that order. Stock
     for the product should drop by the ordered quantity.
3. Check **Supabase → Table Editor → orders** — each test order should show
   `payment_status = paid` and the matching product's `stock` should have
   gone down. Check **products** table stock directly to confirm.
4. Once everything checks out, swap your Paystack/Flutterwave keys from Test
   to Live in Netlify's environment variables and redeploy.

## 8. Ongoing admin use

- **Admin panel**: `https://your-site.netlify.app/admin`
- Log in with the password you chose in step 2 (not the hash — the actual
  password).
- From there you can add/edit/delete products, view orders, confirm bank
  transfers, and view customers.
- Sessions last 24 hours; you'll need to log in again after that.
- Five failed login attempts from the same IP within 15 minutes triggers a
  temporary lockout — this resets automatically after the window passes.

## What to know before you rely on this in production

- **Webhooks are the source of truth** for "was this paid" — the
  `payment-callback.html` page you see right after paying is just a fast,
  friendly confirmation screen; if it ever shows "still processing," the
  order will still complete automatically once the webhook (which usually
  arrives within seconds) lands.
- **Stock decrements only happen once payment is confirmed** — an
  abandoned or unpaid checkout never touches inventory.
- **CORS** on the API functions defaults to your `SITE_URL`. If you add a
  custom domain later, update `SITE_URL` in Netlify's environment variables
  to match it.
- **Rotate keys** if you ever suspect a secret leaked (Paystack/Flutterwave
  dashboards let you regenerate secret keys instantly).
