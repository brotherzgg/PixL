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
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await response.json();
  return data.access_token;
}

router.post("/create-order", async (req, res) => {
  const { type, userId } = req.query;

  if (!type || !PAYMENT_TYPES[type]) {
    return res.status(400).json({
      error: `Invalid payment type. Must be one of: ${Object.keys(PAYMENT_TYPES).join(", ")}`,
    });
  }

  if (!userId) {
    return res.status(400).json({ error: "Missing userId in the request." });
  }

  const amount = PAYMENT_TYPES[type];
  const accessToken = await getAccessToken();

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
    res.json(order);
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({ error: "Failed to create order.", details: error.message || error });
  }
});

router.get("/success", async (req, res) => {
  const orderId = req.query.token;

  if (!orderId) {
    return res.status(400).json({ error: "Missing token in the request." });
  }

  const accessToken = await getAccessToken();
  const captureUrl = `${baseUrl}/v2/checkout/orders/${orderId}/capture`;

  try {
    const response = await fetch(captureUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const capture = await response.json();

    if (capture.status === "COMPLETED") {
      const customId = capture.purchase_units[0]?.payments?.captures[0]?.custom_id;

      if (!customId) {
        return res.status(400).json({
          error: "Payment captured but custom_id is missing in PayPal response.",
          details: capture,
        });
      }

      const [userId, type] = customId.split("-");
      if (!userId || !type || !PAYMENT_TYPES[type]) {
        return res.status(400).json({
          error: "Invalid custom_id format in PayPal response.",
          details: customId,
        });
      }

      const timestamp = new Date().toISOString().slice(2, 10).replace(/-/g, "/");
      const paymentData = { timestamp, type };

      console.log("Attempting to write to Firebase:", { userId, paymentData });

      try {
        const ref = db.ref(`payments/${userId}`);
        const writeResult = await ref.set(paymentData);

        console.log("Firebase write result:", writeResult); // Firebase set() doesn't return anything on success.
        console.log("Successfully wrote to Firebase:", { userId, paymentData });

        return res.redirect(`pixl://payment-success?type=${type}&timestamp=${timestamp}`);
      } catch (firebaseError) {
        console.error("Firebase Write Error:", firebaseError);

        // Log Firebase-specific information for debugging
        console.log("Firebase connection state:", admin.apps[0]?.options?.databaseURL || "Unknown");
        console.log("Firebase service account used:", serviceAccount.client_email);

        return res.status(500).json({
          error: "Payment captured but failed to record in Firebase.",
          details: firebaseError.message || firebaseError,
        });
      }
    } else {
      console.error("Failed to capture payment:", capture);
      return res.status(400).json({ error: "Failed to capture payment.", details: capture });
    }
  } catch (error) {
    console.error("Error during capture:", error);
    return res.status(500).json({
      error: "Unexpected error during payment capture.",
      details: error.message || error,
    });
  }
});

router.get("/cancel", (req, res) => {
  res.redirect("pixl://payment-cancel");
});

app.use("/.netlify/functions/index", router);
module.exports.handler = serverless(app);
