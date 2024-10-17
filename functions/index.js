const express = require("express");
const serverless = require("serverless-http");
const fetch = require("node-fetch");
const app = express();
const router = express.Router();

// PayPal API credentials from Netlify environment variables
const clientId = process.env.PAYPAL_CLIENT_ID;
const secret = process.env.PAYPAL_SECRET;

// URLs for PayPal's sandbox API
const baseUrl = "https://api-m.sandbox.paypal.com";

// Middleware to parse JSON
app.use(express.json());

// Helper function to get access token
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

// Route to create order
router.post("/create-order", async (req, res) => {
  const accessToken = await getAccessToken();
  
  const orderPayload = {
    intent: "CAPTURE",
    purchase_units: [{
      amount: {
        currency_code: "USD",
        value: "10.00"  // Set the amount you want to charge
      }
    }],
    application_context: {
      return_url: "https://pixlcore.netlify.app/success",  // Redirect to success URL
      cancel_url: "https://pixlcore.netlify.app/cancel"    // Redirect to cancel URL
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
  res.json(order);  // Send the entire order JSON, which includes the links
});

// Route to capture order
router.post("/capture-order", async (req, res) => {
  const orderId = req.query.orderId;  // Order ID passed as query parameter
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
  res.json(capture);  // Send the capture result to the client
});

// Use the router for all requests
app.use("/.netlify/functions/index", router);

module.exports.handler = serverless(app);
