// =====================================================================
// Prepaid Energy Monitor — Firebase-backed dashboard logic
// Replaces the old fetch('/data'), fetch('/setRelay'), fetch('/recharge')
// calls to the ESP32's local web server with Firebase Realtime Database
// listeners (live updates) and writes (commands).
// =====================================================================

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();

let relayState = false;
let latestData = {}; // cache of the most recent full snapshot, used across pages

// ---------------- Auth guard ----------------
auth.onAuthStateChanged(user => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }
  startListening();
});

document.getElementById('logout-link').addEventListener('click', () => {
  auth.signOut().then(() => window.location.href = "login.html");
});

// ---------------- Navigation ----------------
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => showPage(link.dataset.page));
});

function showPage(page) {
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  document.getElementById(page + '-section').classList.add('active');
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.querySelector(`.nav-link[data-page="${page}"]`).classList.add('active');
}

// ---------------- Firebase realtime listeners ----------------
function startListening() {
  const deviceRef = db.ref('devices/' + DEVICE_ID);

  // Connection indicator (Firebase's built-in special path)
  db.ref('.info/connected').on('value', snap => {
    const dot = document.getElementById('conn-dot');
    const text = document.getElementById('conn-text');
    if (snap.val() === true) {
      dot.className = 'conn-dot online';
      text.textContent = 'Connected';
    } else {
      dot.className = 'conn-dot offline';
      text.textContent = 'Reconnecting...';
    }
  });

  // Live sensor readings
  deviceRef.child('live').on('value', snap => {
    const live = snap.val() || {};
    latestData.voltage = live.voltage || 0;
    latestData.current = live.current || 0;
    latestData.power = live.power || 0;
    latestData.energyWh = live.energyWh || 0;
    latestData.isValid = live.isValid || false;
    render();
  });

  // Status (relay, faults)
  deviceRef.child('status').on('value', snap => {
    const status = snap.val() || {};
    latestData.relayState = !!status.relayState;
    latestData.faultDetected = !!status.faultDetected;
    latestData.theftDetected = !!status.theftDetected;
    render();
  });

  // Balance (read-only for the client — see firebase_rtdb_rules.json)
  deviceRef.child('balance').on('value', snap => {
    latestData.balance = snap.val() || 0;
    render();
  });

  // Thresholds
  deviceRef.child('thresholds').on('value', snap => {
    const t = snap.val() || {};
    latestData.overVoltage = t.overVoltage;
    latestData.overCurrent = t.overCurrent;
    latestData.theftCurrent = t.theftCurrent;
    latestData.minBalance = t.minBalance;
    latestData.costPerKWh = t.costPerKWh;
    populateSettingsForm();
    render();
  });

  // Alert settings (email + warning threshold)
  deviceRef.child('settings').on('value', snap => {
    const s = snap.val() || {};
    latestData.notifyEmail = s.notifyEmail;
    latestData.lowBalanceWarnAt = s.lowBalanceWarnAt;
    populateSettingsForm();
  });
}

// ---------------- Render everything from latestData ----------------
function render() {
  const d = latestData;
  if (d.voltage === undefined) return; // wait until we have at least one reading

  // Dashboard
  updateElement('balance', fmt(d.balance) + '<span class="unit">₹</span>');
  updateElement('voltage', fmt1(d.voltage) + '<span class="unit">V</span>');
  updateElement('current', fmt3(d.current) + '<span class="unit">A</span>');
  updateElement('power', fmt1(d.power) + '<span class="unit">W</span>');
  updateElement('energy-value', fmt3((d.energyWh || 0) / 1000) + ' kWh');

  updateStatusIndicator('power-indicator', d.relayState ? 'status-active' : 'status-inactive');
  updateElement('power-status', d.relayState ? 'ON' : 'OFF');
  updateStatusIndicator('fault-indicator', d.faultDetected ? 'status-danger' : 'status-active');
  updateElement('fault-status', d.faultDetected ? 'FAULT' : 'OK');
  updateStatusIndicator('theft-indicator', d.theftDetected ? 'status-warning' : 'status-active');
  updateElement('theft-status', d.theftDetected ? 'DETECTED' : 'OK');

  updatePowerControlUI(d.relayState);

  // Account page
  updateElement('account-balance', fmt(d.balance) + '<span class="unit">₹</span>');
  const spend = ((d.energyWh || 0) / 1000) * (d.costPerKWh || 0);
  updateElement('consumption-rate', fmt(spend) + '<span class="unit">₹</span>');

  // Control page
  updateElement('relay-control-status', d.relayState ? 'ON' : 'OFF');
  const overV = d.overVoltage ?? 260, overC = d.overCurrent ?? 10;
  updateStatusIndicator('control-voltage-indicator', (d.voltage < 180 || d.voltage > overV) ? 'status-warning' : 'status-active');
  updateElement('control-voltage-status', d.voltage < 180 ? 'LOW' : (d.voltage > overV ? 'HIGH' : 'OK'));
  updateStatusIndicator('control-current-indicator', d.current > overC ? 'status-warning' : 'status-active');
  updateElement('control-current-status', d.current > overC ? 'OVER' : 'OK');
  updateStatusIndicator('control-fault-indicator', d.faultDetected ? 'status-danger' : 'status-active');
  updateElement('control-fault-status', d.faultDetected ? 'FAULT' : 'OK');
  updateStatusIndicator('control-theft-indicator', d.theftDetected ? 'status-warning' : 'status-active');
  updateElement('control-theft-status', d.theftDetected ? 'DETECTED' : 'OK');

  const now = new Date();
  updateElement('update-timestamp', 'Last updated: ' + now.toLocaleTimeString());
  updateElement('update-status', 'Last Update: ' + now.toLocaleTimeString());
}

function populateSettingsForm() {
  const d = latestData;
  if (d.overVoltage !== undefined) document.getElementById('overVoltage').value = d.overVoltage;
  if (d.overCurrent !== undefined) document.getElementById('overCurrent').value = d.overCurrent;
  if (d.theftCurrent !== undefined) document.getElementById('theftCurrent').value = d.theftCurrent;
  if (d.minBalance !== undefined) document.getElementById('minBalance').value = d.minBalance;
  if (d.costPerKWh !== undefined) document.getElementById('costPerKWh').value = d.costPerKWh;
  if (d.notifyEmail !== undefined) document.getElementById('notifyEmail').value = d.notifyEmail;
  if (d.lowBalanceWarnAt !== undefined) document.getElementById('lowBalanceWarnAt').value = d.lowBalanceWarnAt;
}

// ---------------- Helpers ----------------
function fmt(n) { return (n || 0).toFixed(2); }
function fmt1(n) { return (n || 0).toFixed(1); }
function fmt3(n) { return (n || 0).toFixed(3); }

function updateElement(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function updateStatusIndicator(id, className) {
  const el = document.getElementById(id);
  if (el) el.className = 'status-indicator ' + className;
}

function showAlert(message, type, elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = message;
  el.className = 'alert alert-' + type;
  el.style.display = 'block';
  if (type === 'success') {
    setTimeout(() => { el.style.display = 'none'; }, 4000);
  }
}

function updatePowerControlUI(state) {
  relayState = state;
  const onDash = document.getElementById('power-on-btn');
  const offDash = document.getElementById('power-off-btn');
  const onCtrl = document.getElementById('control-power-on-btn');
  const offCtrl = document.getElementById('control-power-off-btn');

  onDash.disabled = state;
  offDash.disabled = !state;
  onCtrl.disabled = state;
  offCtrl.disabled = !state;
}

// ---------------- Actions (writes to Firebase) ----------------
function setRelay(state) {
  const deviceRef = db.ref('devices/' + DEVICE_ID);
  const activeSection = document.querySelector('.page-section.active').id;
  const alertId = activeSection === 'dashboard-section' ? 'power-control-alert' : 'relay-control-alert';

  showAlert('Sending command...', 'warning', alertId);

  deviceRef.child('commands/relayRequest').set(state === 1)
    .then(() => {
      showAlert(`Power command sent: turning ${state === 1 ? 'ON' : 'OFF'}.`, 'success', alertId);
      // Note: actual relayState will update automatically via the status
      // listener once the device confirms — this just sends the request.
    })
    .catch(err => {
      showAlert('Command failed: ' + err.message, 'danger', alertId);
    });
}
document.getElementById('power-on-btn').addEventListener('click', () => setRelay(1));
document.getElementById('power-off-btn').addEventListener('click', () => setRelay(0));
document.getElementById('control-power-on-btn').addEventListener('click', () => setRelay(1));
document.getElementById('control-power-off-btn').addEventListener('click', () => setRelay(0));

// --- Recharge (real payment via Razorpay, verified by your backend) ---
// Set this to your deployed Render.com backend URL once you have it
// (see STEP_PAYMENT_SETUP.md). This replaces the old direct-write
// method — the client can no longer add balance on its own, only a
// verified payment through the backend can.
const PAYMENT_BACKEND_URL = "https://PASTE-YOUR-RENDER-URL-HERE.onrender.com";

function recharge(amount) {
  amount = parseFloat(amount);
  if (!amount || amount <= 0) return;

  const activeSection = document.querySelector('.page-section.active').id;
  const alertId = activeSection === 'dashboard-section' ? 'power-control-alert' : 'recharge-alert';
  showAlert('Creating payment order...', 'warning', alertId);

  fetch(PAYMENT_BACKEND_URL + '/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount }),
  })
    .then(r => r.json())
    .then(order => {
      if (order.error) throw new Error(order.error);

      const options = {
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: 'Prepaid Energy Meter',
        description: 'Account Recharge',
        order_id: order.orderId,
        handler: function (response) {
          showAlert('Verifying payment...', 'warning', alertId);
          fetch(PAYMENT_BACKEND_URL + '/verify-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              amount: amount,
            }),
          })
            .then(r => r.json())
            .then(result => {
              if (result.success) {
                showAlert(`Recharge successful! New balance: ₹${result.newBalance.toFixed(2)}`, 'success', alertId);
              } else {
                showAlert('Verification failed: ' + (result.error || 'unknown error'), 'danger', alertId);
              }
            })
            .catch(err => showAlert('Verification error: ' + err.message, 'danger', alertId));
        },
        prefill: {
          email: (firebase.auth().currentUser && firebase.auth().currentUser.email) || '',
        },
        theme: { color: '#0a2463' },
      };

      const rzp = new Razorpay(options);
      rzp.on('payment.failed', function (response) {
        showAlert('Payment failed: ' + response.error.description, 'danger', alertId);
      });
      rzp.open();
    })
    .catch(err => showAlert('Recharge failed: ' + err.message, 'danger', alertId));
}
document.getElementById('quick-recharge-btn').addEventListener('click', () => {
  recharge(document.getElementById('quick-recharge-amount').value);
});
document.getElementById('recharge-btn').addEventListener('click', () => {
  recharge(document.getElementById('recharge-amount').value);
});

// --- Save thresholds ---
document.getElementById('save-thresholds-btn').addEventListener('click', () => {
  const thresholds = {
    overVoltage: parseFloat(document.getElementById('overVoltage').value),
    overCurrent: parseFloat(document.getElementById('overCurrent').value),
    theftCurrent: parseFloat(document.getElementById('theftCurrent').value),
    minBalance: parseFloat(document.getElementById('minBalance').value),
    costPerKWh: parseFloat(document.getElementById('costPerKWh').value),
  };
  const settings = {
    notifyEmail: document.getElementById('notifyEmail').value.trim(),
    lowBalanceWarnAt: parseFloat(document.getElementById('lowBalanceWarnAt').value) || 20,
  };

  showAlert('Saving...', 'warning', 'threshold-alert');
  Promise.all([
    db.ref('devices/' + DEVICE_ID + '/thresholds').update(thresholds),
    db.ref('devices/' + DEVICE_ID + '/settings').update(settings),
  ])
    .then(() => showAlert('Settings updated.', 'success', 'threshold-alert'))
    .catch(err => showAlert('Save failed: ' + err.message, 'danger', 'threshold-alert'));
});
