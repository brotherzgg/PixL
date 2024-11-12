// functions/index.js
const admin = require("firebase-admin");
const fetch = require("node-fetch");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

// Function to create PayPal access token
async function getPayPalAccessToken() {
  const response = await fetch("https://api-m.sandbox.paypal.com/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await response.json();
  return data.access_token;
}

// Handler to create a PayPal payment
exports.createPaymentHandler = async (event) => {
  try {
    const { subtype } = JSON.parse(event.body);
    const accessToken = await getPayPalAccessToken();

    // Create an order
    const orderResponse = await fetch("https://api-m.sandbox.paypal.com/v2/checkout/orders", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{ amount: { currency_code: "USD", value: "10.00" } }],
      }),
    });

    const orderData = await orderResponse.json();

    return {
      statusCode: 200,
      body: JSON.stringify({ approvalUrl: orderData.links.find(link => link.rel === "approve").href }),
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: "Failed to create payment" }) };
  }
};

// Handler to capture payment and save data to Firebase
exports.capturePaymentHandler = async (event) => {
  try {
    const { userID, subtype, orderId } = JSON.parse(event.body);
    const accessToken = await getPayPalAccessToken();

    // Capture the payment
    const captureResponse = await fetch(`https://api-m.sandbox.paypal.com/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const captureData = await captureResponse.json();

    if (captureData.status !== "COMPLETED") {
      throw new Error("Payment not completed.");
    }

    // Save data to Firebase
    const timestamp = new Date().toISOString();
    const userRef = admin.database().ref(`payments/${userID}`);
    await userRef.set({ subtype, timestamp });

    return { statusCode: 200, body: JSON.stringify({ message: "Payment captured and data saved successfully" }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: "Failed to capture payment" }) };
  }
};

// Routing based on path
exports.handler = async (event) => {
  if (event.path === "/create-payment") {
    return exports.createPaymentHandler(event);
  } else if (event.path === "/capture-payment") {
    return exports.capturePaymentHandler(event);
  }
  return { statusCode: 404, body: "Not Found" };
};
