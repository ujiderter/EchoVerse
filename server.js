const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const db = new sqlite3.Database('echoverse.db', (err) => {
    if (err) {
        console.error('Database connection error:', err.message);
    } else {
        console.log('✅ Connected to SQLite database');
        initDatabase();
    }
});

function initDatabase() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS realities (
            id TEXT PRIMARY KEY,
            user_session TEXT,
            title TEXT NOT NULL,
            description TEXT,
            original_event TEXT NOT NULL,
            outcomes TEXT, -- JSON array of outcomes
            probability_score REAL,
            impact_score INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS reality_trees (
            id TEXT PRIMARY KEY,
            user_session TEXT,
            tree_data TEXT, -- JSON structure of complete tree
            share_token TEXT UNIQUE,
            is_public BOOLEAN DEFAULT 0,
            view_count INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS analytics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_session TEXT,
            event_type TEXT, -- 'create_reality', 'explore_node', 'share_tree'
            event_data TEXT, -- JSON metadata
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        console.log('✅ Database tables initialized');
    });
}

class AIService {
    constructor() {
        this.fallbackOutcomes = [
            "opened unexpected opportunities", "created new challenges to overcome",
            "led to meeting influential people", "sparked a passion for learning",
            "resulted in a career pivot", "strengthened personal relationships",
            "developed valuable life skills", "inspired creative pursuits",
            "built financial independence", "fostered personal growth"
        ];

        this.fallbackConsequences = [
            "starting a successful business", "moving to a dream location",
            "discovering hidden talents", "building lasting friendships",
            "overcoming personal fears", "achieving work-life balance",
            "contributing to meaningful causes", "mastering new technologies"
        ];
    }

    async generateReality(originalEvent, context = {}) {
        try {
            const outcomes = await this.generateOutcomes(originalEvent);
            const description = await this.generateDescription(originalEvent);
            
            return {
                title: this.extractTitle(originalEvent),
                description,
                outcomes,
                probability: Math.random() * 0.7 + 0.2, // 0.2-0.9
                impact: Math.floor(Math.random() * 8) + 3 // 3-10
            };
        } catch (error) {
            console.error('AI generation error:', error);
            return this.generateFallbackReality(originalEvent);
        }
    }

    async generateOutcomes(event) {
        const numOutcomes = Math.floor(Math.random() * 3) + 2; // 2-4 outcomes
        const outcomes = [];

        for (let i = 0; i < numOutcomes; i++) {
            const outcome = this.fallbackOutcomes[Math.floor(Math.random() * this.fallbackOutcomes.length)];
            const consequence = this.fallbackConsequences[Math.floor(Math.random() * this.fallbackConsequences.length)];
            
            outcomes.push({
                id: uuidv4(),
                title: `Path ${i + 1}`,
                description: `This decision ${outcome}, ultimately leading to ${consequence}`,
                probability: Math.random() * 0.8 + 0.1,
                impact: Math.floor(Math.random() * 10) + 1,
                consequences: [consequence]
            });
        }

        return outcomes;
    }

    async generateDescription(event) {
        const templates = [
            `In this reality, ${event.toLowerCase()} fundamentally changed your life trajectory`,
            `The decision to ${event.toLowerCase()} created a cascade of unexpected events`,
            `By choosing ${event.toLowerCase()}, you entered a completely different timeline`,
            `This alternative where ${event.toLowerCase()} shaped who you became`
        ];
        
        return templates[Math.floor(Math.random() * templates.length)];
    }

    extractTitle(event) {
        return event.replace(/^(what if|if)\s+/i, '').trim();
    }

    generateFallbackReality(event) {
        return {
            title: this.extractTitle(event),
            description: `A reality where ${event.toLowerCase()} led to profound changes`,
            outcomes: [{
                id: uuidv4(),
                title: "Alternative Path",
                description: "This path led to unexpected developments",
                probability: 0.6,
                impact: 7,
                consequences: ["significant life changes"]
            }],
            probability: 0.5,
            impact: 6
        };
    }
}

const aiService = new AIService();

app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.post('/api/realities', async (req, res) => {
    try {
        const { event, userSession = uuidv4() } = req.body;
        
        if (!event || event.trim().length === 0) {
            return res.status(400).json({ error: 'Event description is required' });
        }

        console.log(`Generating reality for: "${event}"`);
        
        const reality = await aiService.generateReality(event);
        const realityId = uuidv4();

        const query = `INSERT INTO realities 
            (id, user_session, title, description, original_event, outcomes, probability_score, impact_score)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        
        db.run(query, [
            realityId,
            userSession,
            reality.title,
            reality.description,
            event,
            JSON.stringify(reality.outcomes),
            reality.probability,
            reality.impact
        ], function(err) {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Failed to save reality' });
            }

            logEvent(userSession, 'create_reality', { event, realityId });

            res.json({
                id: realityId,
                userSession,
                ...reality,
                timestamp: new Date().toISOString()
            });
        });

    } catch (error) {
        console.error('Reality creation error:', error);
        res.status(500).json({ error: 'Failed to generate reality' });
    }
});

app.get('/api/realities/:userSession', (req, res) => {
    const { userSession } = req.params;
    const { limit = 20, offset = 0 } = req.query;

    const query = `SELECT * FROM realities 
        WHERE user_session = ? 
        ORDER BY created_at DESC 
        LIMIT ? OFFSET ?`;

    db.all(query, [userSession, parseInt(limit), parseInt(offset)], (err, rows) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Failed to fetch realities' });
        }

        const realities = rows.map(row => ({
            ...row,
            outcomes: JSON.parse(row.outcomes || '[]')
        }));

        res.json({ realities, count: rows.length });
    });
});

app.post('/api/trees', (req, res) => {
    const { treeData, userSession = uuidv4(), makePublic = false } = req.body;
    const treeId = uuidv4();
    const shareToken = makePublic ? uuidv4() : null;

    const query = `INSERT INTO reality_trees 
        (id, user_session, tree_data, share_token, is_public)
        VALUES (?, ?, ?, ?, ?)`;

    db.run(query, [
        treeId,
        userSession,
        JSON.stringify(treeData),
        shareToken,
        makePublic ? 1 : 0
    ], function(err) {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Failed to save tree' });
        }

        logEvent(userSession, 'save_tree', { treeId, makePublic });

        res.json({
            treeId,
            shareToken,
            shareUrl: shareToken ? `${req.protocol}://${req.get('host')}/share/${shareToken}` : null
        });
    });
});

app.get('/api/trees/share/:shareToken', (req, res) => {
    const { shareToken } = req.params;

    const query = `SELECT * FROM reality_trees WHERE share_token = ? AND is_public = 1`;

    db.get(query, [shareToken], (err, row) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Failed to fetch tree' });
        }

        if (!row) {
            return res.status(404).json({ error: 'Shared tree not found' });
        }

        // Increment view count
        db.run('UPDATE reality_trees SET view_count = view_count + 1 WHERE id = ?', [row.id]);

        res.json({
            id: row.id,
            treeData: JSON.parse(row.tree_data),
            viewCount: row.view_count + 1,
            createdAt: row.created_at
        });
    });
});

app.get('/api/stats/:userSession', (req, res) => {
    const { userSession } = req.params;

    const queries = [
        'SELECT COUNT(*) as reality_count FROM realities WHERE user_session = ?',
        'SELECT COUNT(*) as tree_count FROM reality_trees WHERE user_session = ?',
        'SELECT COUNT(*) as interaction_count FROM analytics WHERE user_session = ?'
    ];

    Promise.all(queries.map(query => 
        new Promise((resolve, reject) => {
            db.get(query, [userSession], (err, result) => {
                if (err) reject(err);
                else resolve(result);
            });
        })
    )).then(([realities, trees, interactions]) => {
        res.json({
            realitiesCreated: realities.reality_count,
            treesSaved: trees.tree_count,
            totalInteractions: interactions.interaction_count,
            diversityScore: Math.floor(realities.reality_count * 1.7 + interactions.interaction_count * 0.3)
        });
    }).catch(err => {
        console.error('Stats error:', err);
        res.status(500).json({ error: 'Failed to fetch stats' });
    });
});

app.post('/api/ai/enhance-reality', async (req, res) => {
    try {
        const { reality, context } = req.body;
        
        const enhanced = {
            ...reality,
            enhancedDescription: `${reality.description} This reality explores themes of personal growth, unexpected opportunities, and the interconnected nature of our choices.`,
            alternativeOutcomes: await aiService.generateOutcomes(reality.title),
            insights: [
                "Every decision creates ripple effects we can't predict",
                "Alternative paths often reveal our hidden potential",
                "The road not taken teaches us about who we are"
            ]
        };

        res.json(enhanced);
    } catch (error) {
        console.error('AI enhancement error:', error);
        res.status(500).json({ error: 'Failed to enhance reality' });
    }
});

function logEvent(userSession, eventType, eventData) {
    const query = 'INSERT INTO analytics (user_session, event_type, event_data) VALUES (?, ?, ?)';
    db.run(query, [userSession, eventType, JSON.stringify(eventData)], (err) => {
        if (err) console.error('Analytics logging error:', err);
    });
}

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down EchoVerse server...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        } else {
            console.log('✅ Database connection closed');
        }
        process.exit(0);
    });
});

app.listen(PORT, () => {
    console.log(`
    🌌 ================================
       EchoVerse API Server Running
    ================================
    🚀 Port: ${PORT}
    🗄️  Database: SQLite (echoverse.db)
    🤖 AI: Enhanced narrative generation
    📊 Features: Reality creation, sharing, analytics
    
    API Endpoints:
    - POST /api/realities - Create new reality
    - GET  /api/realities/:session - Get user realities  
    - POST /api/trees - Save reality tree
    - GET  /api/trees/share/:token - Get shared tree
    - GET  /api/stats/:session - Get user statistics
    - POST /api/ai/enhance-reality - AI enhancement
    
    🌌 Ready to explore infinite possibilities!
    ================================
    `);
});