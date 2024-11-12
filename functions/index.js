const admin = require('firebase-admin');
const paypal = require('@paypal/checkout-server-sdk');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            type: process.env.FIREBASE_TYPE,
            project_id: process.env.FIREBASE_PROJECT_ID,
            private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
            private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            client_email: process.env.FIREBASE_CLIENT_EMAIL,
            client_id: process.env.FIREBASE_CLIENT_ID,
            auth_uri: process.env.FIREBASE_AUTH_URI,
            token_uri: process.env.FIREBASE_TOKEN_URI,
            auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
            client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL
        }),
        databaseURL: process.env.FIREBASE_DATABASE_URL
    });
}

const Environment = process.env.PAYPAL_ENV === 'production'
    ? paypal.core.LiveEnvironment
    : paypal.core.SandboxEnvironment;
const paypalClient = new paypal.core.PayPalHttpClient(new Environment(
    process.env.PAYPAL_CLIENT_ID,
    process.env.PAYPAL_CLIENT_SECRET
));

const captureOrder = async (event, context) => {
    try {

        const { orderId, userID } = event.queryStringParameters;

        if (!orderId || !userID) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "Order ID and User ID are required." })
            };
        }

        const request = new paypal.orders.OrdersCaptureRequest(orderId);
        request.requestBody({});
        const captureResponse = await paypalClient.execute(request);

        if (captureResponse.result.status === 'COMPLETED') {
            const timestamp = new Date().toISOString();

            const dbRef = admin.database().ref(`payments/${userID}`);
            await dbRef.set({
                orderId: orderId,
                status: "COMPLETED",
                timestamp: timestamp,
                subtype: captureResponse.result.purchase_units[0].custom_id || "default"
            });

            return {
                statusCode: 200,
                body: JSON.stringify({ message: "Order captured successfully." })
            };
        } else {
            return {
                statusCode: 500,
                body: JSON.stringify({ message: "Failed to capture order." })
            };
        }
    } catch (error) {
        console.error("Error capturing order:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Internal Server Error" })
        };
    }
};

exports.handler = captureOrder;
