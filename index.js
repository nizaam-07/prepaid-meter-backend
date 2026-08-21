/*
  =====================================================================
  Prepaid Energy Meter — Payment Backend
  =====================================================================
  Small Express server, deployed free on Render.com (no credit card
  required). Does exactly two things, both of which CANNOT be done
  safely from the browser alone:

    1. POST /create-order  — asks Razorpay to create a payment order
    2. POST /verify-payment — verifies Razorpay's cryptographic
       signature proving a payment actually succeeded, THEN (and only
       then) adds the amount to the meter's balance in Firebase using
       an atomic transaction via the Firebase Admin SDK.

  The Admin SDK bypasses Firebase security rules entirely — this is
  intentional and correct: it's the one trusted piece of the whole
  system allowed to write balance. The web dashboard and ESP32 both
  have balance writes blocked in the RTDB rules (see
  firebase_rtdb_rules_LOCKED.json) — only this server can change it.
  =====================================================================
*/

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

// ---------------- Firebase Admin init ----------------
// FIREBASE_SERVICE_ACCOUNT_JSON = the ENTIRE contents of your downloaded
// service account JSON file, pasted as a single-line environment
// variable on Render (see STEP_PAYMENT_SETUP.md).
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});
const db = admin.database();

// ---------------- Razorpay init ----------------
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const DEVICE_ID = process.env.DEVICE_ID || 'meter1';

// ---------------- Routes ----------------
app.get('/', (req, res) => {
  res.send('Prepaid Meter payment backend is running.');
});

// Create a Razorpay order for the given rupee amount
app.post('/create-order', async (req, res) => {
  try {
    const amount = parseFloat(req.body.amount);
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // Razorpay wants paise, not rupees
      currency: 'INR',
      receipt: 'receipt_' + Date.now(),
    });

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID, // safe to expose — this is the public key
    });
  } catch (err) {
    console.error('create-order error:', err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Verify a completed payment's signature, then credit balance
app.post('/verify-payment', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // This is the security-critical step: recompute the signature
    // ourselves using our secret key and compare. Only Razorpay and us
    // know the secret, so a matching signature proves the payment is
    // genuine and wasn't forged by someone calling this endpoint directly.
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      console.warn('Signature mismatch — possible forged request, rejecting.');
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    // Signature verified — safely add to balance using an atomic
    // transaction (safe even if multiple recharges happen close together)
    const balanceRef = db.ref(`devices/${DEVICE_ID}/balance`);
    const result = await balanceRef.transaction(current => (current || 0) + parseFloat(amount));

    // Log this recharge so the dashboard/voice assistant can answer
    // things like "how much did I add last time"
    await db.ref(`devices/${DEVICE_ID}/rechargeHistory`).push({
      amount: parseFloat(amount),
      newBalance: result.snapshot.val(),
      timestamp: admin.database.ServerValue.TIMESTAMP,
    });

    console.log(`Payment verified: +₹${amount} -> new balance ₹${result.snapshot.val()}`);
    res.json({ success: true, newBalance: result.snapshot.val() });
  } catch (err) {
    console.error('verify-payment error:', err);
    res.status(500).json({ error: 'Payment verification failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Payment backend running on port ' + PORT));