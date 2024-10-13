const express = require('express');
const serverless = require('serverless-http');  // Add this line
const paypal = require('paypal-rest-sdk');

const app = express();

app.use(express.json()); // To parse JSON bodies

// PayPal configuration
paypal.configure({
  'mode': 'sandbox', // Change to 'live' for production
  'client_id': process.env.PAYPAL_CLIENT_ID,
  'client_secret': process.env.PAYPAL_CLIENT_SECRET
});

// Root route
app.get('/', (req, res) => {
  res.send('Welcome to the PayPal Integration App!');
});

// PayPal create order route
app.post('/create-order', (req, res) => {
  const create_payment_json = {
    "intent": "sale",
    "payer": { "payment_method": "paypal" },
    "transactions": [{
      "amount": { "currency": "USD", "total": "10.00" },
      "description": "Payment for item"
    }],
    "redirect_urls": {
      "return_url": "https://example.com/success",
      "cancel_url": "https://example.com/cancel"
    }
  };

  paypal.payment.create(create_payment_json, (error, payment) => {
    if (error) {
      res.status(500).send(error);
    } else {
      res.json(payment);
    }
  });
});

// Export the app for Netlify's serverless functions
module.exports.handler = serverless(app);  // Add this line
