const express = require('express');
const paypal = require('paypal-rest-sdk');
const app = express();

app.use(express.json()); // To parse JSON bodies

// PayPal configuration
paypal.configure({
  'mode': 'sandbox', // Change to 'live' for production
  'client_id': process.env.PAYPAL_CLIENT_ID,
  'client_secret': process.env.PAYPAL_CLIENT_SECRET
});

// Root route ("/") - this responds to requests to your app's URL
app.get('/', (req, res) => {
  res.send('Welcome to the PayPal Integration App!');
});

// PayPal route to create an order
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

// Server listening on the environment-defined PORT or 5000 by default
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
