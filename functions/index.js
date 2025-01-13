const express = require("express");
const serverless = require("serverless-http");
const fetch = require("node-fetch");
const admin = require("firebase-admin");

const app = express();
const router = express.Router();

const PAYMENT_TYPES = {
  MType1: "0.99",
  MType2: "9.99",
};

// Validate environment variables
const requiredEnvVars = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_DATABASE_URL",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_SECRET",
];

requiredEnvVars.forEach((key) => {
  if (!process.env[key]) {
    console.error(`Missing environment variable: ${key}`);
    process.exit(1);
  }
});

// Firebase Admin SDK setup
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
};

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
  console.log("Firebase Admin initialized successfully.");
}

const db = admin.database();
const clientId = process.env.PAYPAL_CLIENT_ID;
const secret = process.env.PAYPAL_SECRET;
const baseUrl = "https://api-m.sandbox.paypal.com";

app.use(express.json());

// Cache for PayPal token
let cachedToken = null;
let tokenExpiry = null;

async function getAccessToken() {
  if (cachedToken && tokenExpiry > Date.now()) {
    console.log("Reusing cached PayPal access token.");
    return cachedToken;
  }

  console.log("Fetching new PayPal access token...");
  const auth = Buffer.from(`${clientId}:${secret}`).toString("base64");

  try {
    const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    const data = await response.json();
    if (response.ok) {
      console.log("PayPal access token fetched successfully.");
      cachedToken = data.access_token;
      tokenExpiry = Date.now() + data.expires_in * 1000; // Set token expiry
      return cachedToken;
    } else {
      console.error("Failed to fetch PayPal access token:", data);
      throw new Error(data.error || "Unknown error occurred while fetching access token.");
    }
  } catch (error) {
    console.error("Error fetching PayPal access token:", error);
    throw error;
  }
}

router.post("/create-order", async (req, res) => {
  const { type, userId } = req.query;

  console.log("Received create-order request:", { type, userId });

  if (!type || !PAYMENT_TYPES[type]) {
    console.error("Invalid payment type:", type);
    return res.status(400).json({
      error: `Invalid payment type. Must be one of: ${Object.keys(PAYMENT_TYPES).join(", ")}`,
    });
  }

  if (!userId) {
    console.error("Missing userId in create-order request.");
    return res.status(400).json({ error: "Missing userId in the request." });
  }

  const amount = PAYMENT_TYPES[type];
  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch PayPal access token." });
  }

  const orderPayload = {
    intent: "CAPTURE",
    purchase_units: [
      {
        amount: { currency_code: "USD", value: amount },
        custom_id: `${userId}-${type}`,
      },
    ],
    application_context: {
      return_url: `${req.protocol}://${req.get("host")}/.netlify/functions/index/success`,
      cancel_url: `${req.protocol}://${req.get("host")}/.netlify/functions/index/cancel`,
    },
  };

  console.log("Creating PayPal order with payload:", orderPayload);

  try {
    const response = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(orderPayload),
    });

    const order = await response.json();
    if (response.ok) {
      console.log("PayPal order created successfully:", order);
      res.json(order);
    } else {
      console.error("Failed to create PayPal order:", order);
      res.status(500).json({ error: "Failed to create order.", details: order });
    }
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({ error: "Failed to create order.", details: error.message || error });
  }
});

router.get("/success", async (req, res) => {
  const orderId = req.query.token;

  console.log("Processing success callback with orderId:", orderId);

  if (!orderId) {
    console.error("Missing token in success callback request.");
    return res.status(400).json({ error: "Missing token in the request." });
  }

  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch PayPal access token." });
  }

  const captureUrl = `${baseUrl}/v2/checkout/orders/${orderId}/capture`;

  console.log("Capturing PayPal order with URL:", captureUrl);

  try {
    const response = await fetch(captureUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const capture = await response.json();
    if (response.ok && capture.status === "COMPLETED") {
      console.log("Payment successfully captured:", capture);

      const customId = capture.purchase_units[0]?.payments?.captures[0]?.custom_id;
      const [userId, type] = customId.split("-");
      const timestamp = new Date().toISOString().slice(2, 10).replace(/-/g, "/");

      console.log("Recording payment in Firebase:", { userId, type, timestamp });

      try {
        await db.ref(`payments/${userId}`).set({ timestamp, type });
        console.log("Payment recorded successfully in Firebase.");
        return res.redirect(`pixl://payment-success?type=${encodeURIComponent(type)}&timestamp=${encodeURIComponent(timestamp)}`);
      } catch (firebaseError) {
        console.error("Error writing payment to Firebase:", firebaseError);
        return res.status(500).json({ error: "Failed to record payment in Firebase.", details: firebaseError.message });
      }
    } else {
      console.error("Payment capture failed:", capture);
      res.status(400).json({ error: "Failed to capture payment.", details: capture });
    }
  } catch (error) {
    console.error("Error capturing payment:", error);
    res.status(500).json({ error: "Unexpected error during payment capture.", details: error.message || error });
  }
});

router.get("/cancel", (req, res) => {
  console.log("Payment canceled by user.");
  res.redirect("pixl://payment-cancel");
});

app.use("/.netlify/functions/index", router);
module.exports.handler = serverless(app);
