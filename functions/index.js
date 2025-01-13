const express = require("express");
const fetch = require("node-fetch");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");

const app = express();
const router = express.Router();

// Environment variables and constants
const baseUrl = "https://api-m.sandbox.paypal.com";

// Middleware
app.use(bodyParser.json());

// Firebase initialization
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}
const db = admin.database();

// Helper: Fetch PayPal Access Token
async function getAccessToken() {
  console.log("Fetching new PayPal access token...");
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString("base64");

  try {
    const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to fetch PayPal access token:", errorText);
      throw new Error(`PayPal token fetch error: ${errorText}`);
    }

    const data = await response.json();
    console.log("PayPal access token fetched successfully:", data);
    return data.access_token;
  } catch (error) {
    console.error("Error fetching PayPal access token:", error);
    throw error;
  }
}

// POST /create-order
router.post("/create-order", async (req, res) => {
  const { type, userId } = req.body;

  console.log("Received create-order request:", { type, userId });

  if (!type || !userId) {
    console.error("Missing type or userId in request.");
    return res.status(400).json({ error: "Missing required parameters." });
  }

  try {
    const accessToken = await getAccessToken();

    const payload = {
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: "USD",
            value: type === "MType1" ? "5.99" : "9.99",
          },
          custom_id: `${userId}-${type}`,
        },
      ],
      application_context: {
        return_url: "https://pixlcore.netlify.app/.netlify/functions/index/success",
        cancel_url: "https://pixlcore.netlify.app/.netlify/functions/index/cancel",
      },
    };

    console.log("Creating PayPal order with payload:", JSON.stringify(payload));

    const response = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const order = await response.json();

    if (response.ok) {
      console.log("PayPal order created successfully:", order);
      return res.json({ id: order.id });
    } else {
      console.error("Failed to create PayPal order:", order);
      res.status(500).json({ error: "Failed to create order.", details: order });
    }
  } catch (error) {
    console.error("Error creating PayPal order:", error);
    res.status(500).json({ error: "Unexpected error.", details: error.message });
  }
});

// POST /success
router.post("/success", async (req, res) => {
  const { orderId } = req.body;

  console.log("Processing success callback with orderId:", orderId);

  if (!orderId) {
    console.error("Missing orderId in request.");
    return res.status(400).json({ error: "Missing orderId." });
  }

  try {
    const accessToken = await getAccessToken();

    const captureUrl = `${baseUrl}/v2/checkout/orders/${orderId}/capture`;
    console.log("Capturing PayPal order with URL:", captureUrl);

    const response = await fetch(captureUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();

    if (response.ok) {
      console.log("Payment successfully captured:", data);

      // Extract custom_id and record payment in Firebase
      const [userId, type] = data.purchase_units[0].custom_id.split("-");
      const timestamp = new Date().toISOString();

      const record = { userId, type, timestamp };
      console.log("Recording payment in Firebase:", record);

      await db.ref(`/payments/${userId}`).push(record);
      console.log("Payment recorded in Firebase successfully.");

      return res.json({ status: "COMPLETED" });
    } else {
      console.error("Failed to capture PayPal order:", data);
      res.status(500).json({ error: "Failed to capture payment.", details: data });
    }
  } catch (error) {
    console.error("Error capturing PayPal order:", error);
    res.status(500).json({ error: "Unexpected error.", details: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error." });
});

// Attach router and export
app.use("/", router);
module.exports = app;
