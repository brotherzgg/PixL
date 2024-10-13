const express = require('express');
const serverless = require('serverless-http');
const bodyParser = require('body-parser');
const paypal = require('@paypal/checkout-server-sdk');

const app = express();
app.use(bodyParser.json());

const Environment = paypal.core.SandboxEnvironment;
const paypalClient = new paypal.core.PayPalHttpClient(new Environment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET));

app.post('/create-order', async (req, res) => {
    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
        intent: 'CAPTURE',
        purchase_units: [{ amount: { currency_code: 'USD', value: '10.00' } }]
    });

    try {
        const order = await paypalClient.execute(request);
        res.status(201).json({ id: order.result.id });
    } catch (err) {
        res.status(500).send(err.toString());
    }
});

module.exports.handler = serverless(app);
