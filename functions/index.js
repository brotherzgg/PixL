const express = require("express");
const serverless = require("serverless-http");
const fetch = require("node-fetch");
const admin = require("firebase-admin");

const app = express();
const router = express.Router();

const PAYMENT_TYPES = {
  MType1: "0.99",
  MType2: "9.99"
};

const serviceAccount = {
  "type": "service_account",
  "project_id": process.env.FIREBASE_PROJECT_ID,
  "private_key_id": process.env.FIREBASE_PRIVATE_KEY_ID,
  "private_key": process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  "client_email": process.env.FIREBASE_CLIENT_EMAIL,
  "client_id": process.env.FIREBASE_CLIENT_ID,
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": process.env.FIREBASE_CLIENT_CERT_URL
};

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}

const db = admin.database();

const clientId = process.env.PAYPAL_CLIENT_ID;
const secret = process.env.PAYPAL_SECRET;
const baseUrl = "https://api-m.sandbox.paypal.com";

app.use(express.json());

async function getAccessToken() {
  const auth = Buffer.from(`${clientId}:${secret}`).toString("base64");

  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  const data = await response.json();
  return data.access_token;
}

router.post("/create-order", async (req, res) => {
  const { type } = req.query; 

  if (!type || !PAYMENT_TYPES[type]) {
    return res.status(400).json({ 
      error: "Invalid payment type. Must be one of: " + Object.keys(PAYMENT_TYPES).join(", ") 
    });
  }

  const amount = PAYMENT_TYPES[type];
  const accessToken = await getAccessToken();

  const orderPayload = {
    intent: "CAPTURE",
    purchase_units: [{
      amount: {
        currency_code: "USD",
        value: amount
      },
      custom_id: type  
    }],
    application_context: {
      return_url: "https://pixlcore.netlify.app/success",
      cancel_url: "https://pixlcore.netlify.app/cancel"
    }
  };

  const response = await fetch(`${baseUrl}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(orderPayload)
  });

  const order = await response.json();
  res.json(order);
});

router.post("/capture-order", async (req, res) => {
  const orderId = req.query.orderId;
  const userId = req.query.userId;
  const accessToken = await getAccessToken();

  const captureUrl = `${baseUrl}/v2/checkout/orders/${orderId}/capture`;

  const response = await fetch(captureUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    }
  });

  const capture = await response.json();

  if (capture.status === "COMPLETED") {
    const timestamp = new Date().toISOString();
    const type = capture.purchase_units[0].custom_id; 

    try {
      await db.ref(`payments/${userId}`).set({
        timestamp: timestamp,
        type: type,
        amount: PAYMENT_TYPES[type]
      });
      res.json({ 
        message: "Payment captured and recorded successfully.",
        type: type,
        amount: PAYMENT_TYPES[type]
      });
    } catch (error) {
      res.status(500).json({ error: "Payment captured but failed to record in Firebase." });
    }
  } else {
    res.status(400).json({ error: "Failed to capture payment." });
  }
});

app.use("/.netlify/functions/index", router);
module.exports.handler = serverless(app);
