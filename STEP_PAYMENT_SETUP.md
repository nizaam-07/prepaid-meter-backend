# Payment Gateway Setup — Razorpay (Test Mode) + Free Backend on Render.com

## What this adds
- Real "Pay Now" checkout popup (Razorpay) when you click Recharge
- A small free backend that verifies the payment is genuine before adding balance
- Balance is now **permanently locked** from direct writes — only a verified payment can change it

**Test mode = zero real money, zero fees, completely free.** You'll use fake test cards.

---

## 1. Create a free Razorpay account
1. Go to https://razorpay.com → Sign Up (free, no card needed for test mode).
2. After signing in, look at the top-left toggle — make sure it says **Test Mode** (not Live Mode).
3. Go to **Settings → API Keys** (left sidebar) → **Generate Test Key**.
4. Copy both the **Key Id** and **Key Secret** — you'll need both in step 4.

## 2. Get a Firebase service account key
This lets your backend write to Firebase with full trust (bypassing the security rules), which is what allows it to safely add balance.
1. Firebase Console → your project → **Project settings** (gear icon) → **Service accounts** tab.
2. Click **Generate new private key** → confirm → a `.json` file downloads.
3. Open that file in a text editor — you'll paste its entire contents into Render in step 4. Keep this file private, never commit it to a public GitHub repo.

## 3. Push the backend code to GitHub
Render deploys from a GitHub repo, so:
1. Go to https://github.com → create a **new repository** (can be private), e.g. `prepaid-meter-backend`.
2. On your computer, open a terminal in the `backend` folder (the one with `index.js` and `package.json`).
3. Run:
```
git init
git add .
git commit -m "Initial payment backend"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/prepaid-meter-backend.git
git push -u origin main
```
(Replace the URL with your actual new repo's URL, shown on the GitHub page after creating it.)

## 4. Deploy to Render.com (free, no card)
1. Go to https://render.com → Sign up (free, no card required for a Web Service on the free tier).
2. Dashboard → **New +** → **Web Service**.
3. Connect your GitHub account → select the `prepaid-meter-backend` repo you just pushed.
4. Settings:
   - **Name:** anything, e.g. `prepaid-meter-backend`
   - **Region:** closest to you
   - **Branch:** main
   - **Root Directory:** leave blank (unless you put the backend in a subfolder)
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. Scroll to **Environment Variables** → add these:
   | Key | Value |
   |---|---|
   | `RAZORPAY_KEY_ID` | your Test Key Id from step 1 |
   | `RAZORPAY_KEY_SECRET` | your Test Key Secret from step 1 |
   | `FIREBASE_DATABASE_URL` | `https://prepaid-smart-energy-met-9698c-default-rtdb.firebaseio.com` |
   | `FIREBASE_SERVICE_ACCOUNT_JSON` | paste the **entire contents** of the service account JSON file from step 2, as one value |
   | `DEVICE_ID` | `meter1` |
6. Click **Create Web Service**. First deploy takes a few minutes.
7. Once live, Render shows you a URL like `https://prepaid-meter-backend.onrender.com` — copy it.

**Free tier note:** the backend "sleeps" after ~15 minutes of no traffic, and the first request after that takes ~30-50 seconds to wake up. Totally fine for a personal project — just means the very first recharge attempt after a while might feel slow before the payment popup appears.

## 5. Connect the dashboard to your backend
1. Open `app.js` → find this line near the top of the recharge section:
   ```js
   const PAYMENT_BACKEND_URL = "https://PASTE-YOUR-RENDER-URL-HERE.onrender.com";
   ```
2. Replace it with your actual Render URL from step 4.7 (no trailing slash).
3. Replace your local `public/index.html` and `public/app.js` with the updated ones I gave you.

## 6. Lock down the database rules
Firebase Console → Realtime Database → Rules tab → paste the contents of `firebase_rtdb_rules_LOCKED.json` → **Publish**.

This permanently blocks any direct client write to `balance` — from now on, only your verified backend can change it.

## 7. Deploy and test
```
firebase deploy --only hosting
```
Then on your live dashboard:
1. Go to Account (or Dashboard quick recharge) → enter an amount → click Recharge.
2. A Razorpay checkout popup should open.
3. Use a **test card**: card number `4111 1111 1111 1111`, any future expiry date, any 3-digit CVV, any name.
4. Complete the "payment" → popup closes → you should see "Recharge successful! New balance: ₹..." within a couple seconds.
5. Confirm the balance updated in Firebase console too.

### Other test payment methods (all fake, all free)
- **UPI:** use `success@razorpay` as the UPI ID to simulate a successful payment.
- **Netbanking:** pick any test bank from the list, it auto-succeeds in test mode.

## Troubleshooting
- **Popup doesn't open at all:** check browser console (F12) for errors — likely `PAYMENT_BACKEND_URL` wasn't updated, or the backend is still deploying/waking up.
- **"Recharge failed: Failed to fetch":** backend might be asleep (free tier) — wait ~40 seconds and try again, or check Render's dashboard logs for crashes.
- **"Invalid payment signature":** double-check `RAZORPAY_KEY_SECRET` on Render matches exactly what's shown in Razorpay's dashboard (Test Key).
- **Balance doesn't update but payment succeeded:** check Render's live logs (Render dashboard → your service → Logs) for the exact error from `/verify-payment`.

---

**Once test payments are working end-to-end, let me know.** Going live later (real money) just means switching Razorpay to Live Mode (requires basic KYC — PAN card, bank account), generating Live API keys, and swapping them into Render's environment variables — no code changes needed.
