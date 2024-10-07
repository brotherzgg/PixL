const express = require('express');
const paypal = require('paypal-rest-sdk');
const app = express();

// PayPal configuration
paypal.configure({
  'mode': 'sandbox', // 'live' for production
  'client_id': process.env.PAYPAL_CLIENT_ID,
  'client_secret': process.env.PAYPAL_CLIENT_SECRET
});

app.use(express.json());

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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});