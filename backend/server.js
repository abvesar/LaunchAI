// backend/server.js
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const Razorpay = require('razorpay');

const app = express();
const frontendDir = path.join(__dirname, 'frontend');

app.use(cors());
app.use(express.json());
app.use(express.static(frontendDir));

const isRealRazorpayConfigured = () => {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    return Boolean(keyId && keySecret && !keyId.includes('mock') && !keySecret.includes('mock'));
};

const razorpay = isRealRazorpayConfigured()
    ? new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
    })
    : null;

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.post('/api/create-order', async (req, res) => {
    const { plan, amount } = req.body;
    const safeAmount = Number(amount) || 0;

    if (!plan || safeAmount <= 0) {
        return res.status(400).json({ success: false, message: 'Valid plan and amount are required.' });
    }

    if (!razorpay) {
        return res.status(200).json({
            success: true,
            order_id: `mock_order_${plan.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`,
            amount: Math.round(safeAmount * 100),
            key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_mockkey123',
            mock: true,
            message: 'Using a mock checkout because Razorpay credentials are not configured.'
        });
    }

    const options = {
        amount: Math.round(safeAmount * 100),
        currency: 'INR',
        receipt: `receipt_${plan}_${Date.now()}`
    };

    try {
        const order = await razorpay.orders.create(options);
        res.status(200).json({
            success: true,
            order_id: order.id,
            amount: order.amount,
            key_id: razorpay.key_id
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(frontendDir, 'index.html'));
});

app.get('/dashboard.html', (req, res) => {
    res.sendFile(path.join(frontendDir, 'dashboard.html'));
});

app.use((req, res) => {
    res.sendFile(path.join(frontendDir, 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Beta server running on port ${PORT}`));
