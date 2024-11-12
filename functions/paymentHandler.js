const fetch = require('node-fetch');
const admin = require('firebase-admin');

const CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;

const serviceAccount = JSON.parse(process.env.FIREBASE_PRIVATE_KEY);
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: "https://prdownload-5085c-default-rtdb.asia-southeast1.firebasedatabase.app",
    });
}

async function callPayPalAPI(endpoint, method, body) {
    const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

    const response = await fetch(`https:
        method,
        headers: {
            "Authorization": `Basic ${auth}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });

    return response.json();
}

exports.handler = async (event) => {

    const path = event.path;
    const method = event.httpMethod;

    if (method === "POST") {
        try {
            const { orderId, userId, action } = JSON.parse(event.body);

            if (action === "create_order") {

                const order = await callPayPalAPI("/v2/checkout/orders", "POST", {
                    intent: "CAPTURE",
                    purchase_units: [{ amount: { currency_code: "USD", value: "10.00" } }]
                });

                return {
                    statusCode: 200,
                    body: JSON.stringify(order),
                };
            } else if (action === "capture_order" && orderId && userId) {

                const capture = await callPayPalAPI(`/v2/checkout/orders/${orderId}/capture`, "POST");

                if (capture.status === "COMPLETED") {

                    const paymentData = {
                        type: "membership_type_here",
                        timestamp: new Date().toISOString()
                    };

                    await admin.database().ref(`users/${userId}/payments`).push(paymentData);

                    return {
                        statusCode: 200,
                        body: JSON.stringify({ message: "Payment recorded successfully" }),
                    };
                } else {
                    return {
                        statusCode: 400,
                        body: JSON.stringify({ error: "Payment not completed" }),
                    };
                }
            } else {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: "Invalid action or missing parameters" }),
                };
            }
        } catch (error) {
            console.error("Error handling payment:", error);
            return {
                statusCode: 500,
                body: JSON.stringify({ error: "Payment process failed" }),
            };
        }
    } else {
        return { statusCode: 405, body: "Method Not Allowed" };
    }
};
