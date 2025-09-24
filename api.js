const express = require('express');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests from this IP'
});
app.use('/api/', limiter);

const NEURAL_CONFIG = {
    openai: {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
        }
    },
    anthropic: {
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01'
        }
    }
};

async function makeNeuralRequest(provider, prompt, options = {}) {
    try {
        const config = NEURAL_CONFIG[provider];
        if (!config) {
            throw new Error(`Unsupported provider: ${provider}`);
        }

        let requestData;

        if (provider === 'openai') {
            requestData = {
                model: options.model || 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: options.maxTokens || 150,
                temperature: options.temperature || 0.7
            };
        } else if (provider === 'anthropic') {
            requestData = {
                model: options.model || 'claude-3-sonnet-20240229',
                max_tokens: options.maxTokens || 150,
                messages: [{ role: 'user', content: prompt }]
            };
        }

        const response = await axios.post(config.url, requestData, {
            headers: config.headers,
            timeout: 30000
        });

        return {
            success: true,
            data: response.data,
            provider,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        return {
            success: false,
            error: error.response?.data?.error || error.message,
            provider,
            timestamp: new Date().toISOString()
        };
    }
}

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.post('/api/generate', async (req, res) => {
    const { prompt, provider = 'openai', options = {} } = req.body;

    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' });
    }

    const result = await makeNeuralRequest(provider, prompt, options);

    if (result.success) {
        res.json(result);
    } else {
        res.status(500).json(result);
    }
});

app.post('/api/batch', async (req, res) => {
    const { prompts, provider = 'openai', options = {} } = req.body;

    if (!Array.isArray(prompts) || prompts.length === 0) {
        return res.status(400).json({ error: 'Prompts array is required' });
    }

    const results = await Promise.allSettled(
        prompts.map(prompt => makeNeuralRequest(provider, prompt, options))
    );

    const responses = results.map((result, index) => ({
        index,
        ...result.value
    }));

    res.json({ responses, total: prompts.length });
});

app.get('/api/providers', (req, res) => {
    res.json({
        available: Object.keys(NEURAL_CONFIG),
             default: 'openai'
    });
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

app.use('*', (req, res) => {
    res.status(404).json({ error: 'Route not found' });
});
