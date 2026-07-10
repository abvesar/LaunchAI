require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const Razorpay = require('razorpay');
const mongoose = require('mongoose');
const { OpenAI } = require('openai');

const app = express();
const frontendDir = path.join(__dirname, 'frontend');

app.use(cors());
app.use(express.json());
app.use(express.static(frontendDir));

const hasValue = (value) => Boolean(value && String(value).trim() && !String(value).includes('mock'));
const useRazorpay = hasValue(process.env.RAZORPAY_KEY_ID) && hasValue(process.env.RAZORPAY_KEY_SECRET);
const useOpenAI = hasValue(process.env.OPENAI_API_KEY);

mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/launchai', {
    serverSelectionTimeoutMS: 5000
})
    .then(() => console.log('✅ MongoDB connected successfully.'))
    .catch(err => console.warn('⚠️ MongoDB not connected:', err.message));

const ProjectSchema = new mongoose.Schema({
    userId: { type: String, default: 'anonymous_beta_user' },
    industry: String,
    description: String,
    generatedNames: [String],
    businessPlan: String,
    createdAt: { type: Date, default: Date.now }
});
const Project = mongoose.model('Project', ProjectSchema);

const razorpay = useRazorpay
    ? new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
    })
    : null;

const openai = useOpenAI
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        paymentMode: useRazorpay ? 'live' : 'mock',
        aiMode: useOpenAI ? 'live' : 'mock'
    });
});

app.post('/api/create-order', async (req, res) => {
    const { plan, amount } = req.body;
    const safeAmount = Number(amount) || 0;

    if (!plan || safeAmount <= 0) {
        return res.status(400).json({ success: false, message: 'Valid plan and amount are required.' });
    }

    if (!razorpay) {
        return res.json({
            success: true,
            order_id: `mock_order_${plan.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`,
            amount: Math.round(safeAmount * 100),
            key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_mockkey123',
            mock: true,
            message: 'Using a mock checkout because Razorpay credentials are not configured.'
        });
    }

    try {
        const order = await razorpay.orders.create({
            amount: Math.round(safeAmount * 100),
            currency: 'INR',
            receipt: `receipt_${Date.now()}`
        });
        res.json({ success: true, order_id: order.id, amount: order.amount, key_id: razorpay.key_id });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/generate-startup', async (req, res) => {
    const { industry, description } = req.body;

    if (!industry || !description) {
        return res.status(400).json({ success: false, message: 'Missing inputs.' });
    }

    if (!openai) {
        const mockNames = [
            `${industry} Labs`,
            `${industry} Studio`,
            `${industry} Ventures`
        ];
        const mockPlan = `A lean launch plan for ${industry}: validate the problem, build a simple MVP, and test early customer interest with a focused outreach campaign.`;

        const savedProject = await Project.create({
            industry,
            description,
            generatedNames: mockNames,
            businessPlan: mockPlan
        });

        return res.json({
            success: true,
            projectId: savedProject._id,
            names: savedProject.generatedNames,
            plan: savedProject.businessPlan,
            mock: true,
            message: 'Using a mock AI response because OPENAI_API_KEY is not configured.'
        });
    }

    try {
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: "You are an elite startup incubator director. Provide output strictly in structured JSON format with two keys: 'names' (an array of 3 creative brand names) and 'plan' (a concise 3-sentence execution strategy)."
                },
                {
                    role: 'user',
                    content: `Industry: ${industry}. Description: ${description}.`
                }
            ],
            response_format: { type: 'json_object' }
        });

        const aiData = JSON.parse(completion.choices[0].message.content || '{}');
        const names = Array.isArray(aiData.names) && aiData.names.length > 0
            ? aiData.names.slice(0, 3)
            : [`${industry} Labs`, `${industry} Studio`, `${industry} Ventures`];
        const plan = typeof aiData.plan === 'string' && aiData.plan.trim()
            ? aiData.plan
            : `A lean launch plan for ${industry}: validate the problem, build a simple MVP, and test early customer interest with a focused outreach campaign.`;

        const savedProject = await Project.create({
            industry,
            description,
            generatedNames: names,
            businessPlan: plan
        });

        res.json({
            success: true,
            projectId: savedProject._id,
            names: savedProject.generatedNames,
            plan: savedProject.businessPlan
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'AI processing failure.' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(frontendDir, 'index.html'));
});

app.get('/dashboard.html', (req, res) => {
    res.sendFile(path.join(frontendDir, 'dashboard.html'));
});

app.get('/frontend.html', (req, res) => {
    res.sendFile(path.join(frontendDir, 'frontend.html'));
});

app.use((req, res) => {
    res.sendFile(path.join(frontendDir, 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Live Backend Engine working on port ${PORT}`));
const crypto = require('crypto');

// Endpoint to verify Razorpay signature securely
app.post('/api/verify-payment', async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan, industry, description } = req.body;

    // 1. Generate the expected signature using your local secret
    const text = razorpay_order_id + "|" + razorpay_payment_id;
    const generated_signature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(text.toString())
        .digest('hex');

    // 2. Comapre signatures cryptographically
    if (generated_signature === razorpay_signature) {
        try {
            // Payment verified! Securely call OpenAI here and process the generation
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: "You are an elite startup incubator director. Output JSON with keys: 'names' (array of 3 names) and 'plan' (3-sentence strategy)." },
                    { role: "user", content: `Industry: ${industry}. Description: ${description}.` }
                ],
                response_format: { type: "json_object" }
            });

            const aiData = JSON.parse(completion.choices.message.content);

            // Save the paid project to MongoDB
            const finalizedProject = await Project.create({
                industry,
                description,
                generatedNames: aiData.names,
                businessPlan: aiData.plan,
                userId: "verified_paid_customer" // Map to user session in future updates
            });

            return res.json({ 
                success: true, 
                message: "Payment verified and project built!",
                data: finalizedProject 
            });

        } catch (aiError) {
            return res.status(500).json({ success: false, message: "Payment verified but AI failed." });
        }
    } else {
        return res.status(400).json({ success: false, message: "Invalid payment signature. Transaction blocked." });
    }
});
