const express = require("express");
const fetch = require("node-fetch");
const firebase = require("firebase-admin");
const { Router } = require("express");

firebase.initializeApp({
  credential: firebase.credential.cert(JSON.parse(process.env.FIREBASE_ADMIN)),
  databaseURL: process.env.FIREBASE_DB_URL,
});

const db = firebase.database();
const router = Router();

const baseUrl = "https://api-m.sandbox.paypal.com";

function withTimeout(promise, ms) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Operation timed out")), ms)
  );
  return Promise.race([promise, timeout]);
}

async function getAccessToken() {
  console.log("Fetching new PayPal access token...");
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString("base64");

  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const error = await response.json();
    console.error("Failed to fetch PayPal access token:", error);
    throw new Error("Could not fetch access token.");
  }

  const { access_token } = await response.json();
  console.log("PayPal access token fetched successfully.");
  return access_token;
}

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

    console.log("Creating PayPal order with payload:", payload);

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
        await withTimeout(
          db.ref(`payments/${userId}`).set({ timestamp, type }),
          10000 // 10-second timeout
        );
        console.log("Payment recorded successfully in Firebase.");
        return res.redirect(`pixl://payment-success?type=${encodeURIComponent(type)}&timestamp=${encodeURIComponent(timestamp)}`);
      } catch (firebaseError) {
        console.error("Error writing payment to Firebase (with timeout):", firebaseError);
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
  console.log("Payment cancelled by user.");
  res.redirect("pixl://payment-cancel");
});

module.exports = router;
