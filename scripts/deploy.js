#!/usr/bin/env node

// scripts/deploy.js - Deployment automation script for EchoVerse
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEPLOY_TARGETS = {
    local: 'Local Docker development',
    staging: 'Staging environment',
    production: 'Production deployment',
    heroku: 'Heroku Platform',
    vercel: 'Vercel + Railway'
};

class EchoVerseDeployer {
    constructor() {
        this.target = process.argv[2] || 'local';
        this.version = this.getVersion();
        this.timestamp = new Date().toISOString();
    }

    getVersion() {
        try {
            const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
            return packageJson.version || '1.0.0';
        } catch {
            return '1.0.0';
        }
    }

    log(message, type = 'info') {
        const colors = {
            info: '\x1b[36m',    // Cyan
            success: '\x1b[32m', // Green
            warning: '\x1b[33m', // Yellow
            error: '\x1b[31m',   // Red
            reset: '\x1b[0m'
        };
        
        console.log(`${colors[type]}🌌 [EchoVerse Deploy] ${message}${colors.reset}`);
    }

    exec(command, description) {
        this.log(`Executing: ${description}...`);
        try {
            const output = execSync(command, { encoding: 'utf8', stdio: 'inherit' });
            return output;
        } catch (error) {
            this.log(`Failed: ${description}`, 'error');
            throw error;
        }
    }

    async deployLocal() {
        this.log('🐳 Starting local Docker deployment...');
        
        // Build and start containers
        this.exec('docker-compose down', 'Stopping existing containers');
        this.exec('docker-compose build --no-cache', 'Building fresh images');
        this.exec('docker-compose up -d', 'Starting services');
        
        // Wait for services to be healthy
        this.log('⏳ Waiting for services to be ready...');
        await this.sleep(10000);
        
        // Health checks
        await this.healthCheck('http://localhost:3001/api/health', 'Backend API');
        await this.healthCheck('http://localhost:8080/health', 'Frontend');
        
        this.log('✅ Local deployment successful!', 'success');
        this.log('🔗 Frontend: http://localhost:8080', 'info');
        this.log('🔗 API: http://localhost:3001', 'info');
        this.log('🔗 API Docs: http://localhost:3001/api/health', 'info');
    }

    async deployHeroku() {
        this.log('🚀 Starting Heroku deployment...');
        
        // Check if Heroku CLI is installed
        try {
            this.exec('heroku --version', 'Checking Heroku CLI');
        } catch {
            throw new Error('Heroku CLI not installed. Install from: https://devcenter.heroku.com/articles/heroku-cli');
        }
        
        // Create Heroku apps if they don't exist
        const appName = `echoverse-${this.target}`;
        
        try {
            this.exec(`heroku create ${appName} --region us`, 'Creating Heroku app');
        } catch {
            this.log('App already exists, continuing...', 'warning');
        }
        
        // Set environment variables
        const envVars = [
            'NODE_ENV=production',
            'ENABLE_AI_GENERATION=false',
            'ENABLE_REALITY_SHARING=true',
            'ENABLE_ANALYTICS=true',
            'LOG_LEVEL=info'
        ];
        
        envVars.forEach(env => {
            this.exec(`heroku config:set ${env} --app ${appName}`, `Setting ${env}`);
        });
        
        // Deploy
        this.exec(`git push heroku main --app ${appName}`, 'Deploying to Heroku');
        
        // Health check
        const appUrl = `https://${appName}.herokuapp.com`;
        await this.sleep(30000); // Wait for app to start
        await this.healthCheck(`${appUrl}/api/health`, 'Heroku deployment');
        
        this.log(`✅ Heroku deployment successful! App: ${appUrl}`, 'success');
    }

    async deployVercel() {
        this.log('▲ Starting Vercel deployment...');
        
        // Create vercel.json for frontend
        const vercelConfig = {
            version: 2,
            name: 'echoverse-frontend',
            builds: [
                {
                    src: 'public/**/*',
                    use: '@vercel/static'
                }
            ],
            routes: [
                {
                    src: '/api/(.*)',
                    dest: 'https://your-railway-backend.up.railway.app/api/$1'
                },
                {
                    src: '/(.*)',
                    dest: '/public/$1'
                }
            ],
            headers: [
                {
                    source: '/api/(.*)',
                    headers: [
                        {
                            key: 'Access-Control-Allow-Origin',
                            value: '*'
                        }
                    ]
                }
            ]
        };
        
        fs.writeFileSync('vercel.json', JSON.stringify(vercelConfig, null, 2));
        
        try {
            this.exec('vercel --version', 'Checking Vercel CLI');
        } catch {
            this.exec('npm i -g vercel', 'Installing Vercel CLI');
        }
        
        this.exec('vercel --prod', 'Deploying to Vercel');
        
        this.log('✅ Vercel deployment initiated!', 'success');
        this.log('💡 Don\'t forget to deploy backend to Railway/Render', 'warning');
    }

    async deployProduction() {
        this.log('🏭 Starting production deployment...');
        
        // Pre-deployment checks
        await this.runTests();
        await this.securityAudit();
        
        // Build production images
        this.exec('docker-compose -f docker-compose.yml -f docker-compose.prod.yml build', 'Building production images');
        
        // Deploy with zero-downtime
        this.exec('docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d', 'Starting production services');
        
        // Run post-deployment tests
        await this.sleep(15000);
        await this.healthCheck('http://localhost:3001/api/health', 'Production API');
        
        this.log('✅ Production deployment successful!', 'success');
    }

    async runTests() {
        this.log('🧪 Running test suite...');
        try {
            this.exec('npm test', 'Running tests');
            this.log('✅ All tests passed!', 'success');
        } catch (error) {
            this.log('❌ Tests failed! Aborting deployment.', 'error');
            throw error;
        }
    }

    async securityAudit() {
        this.log('🔒 Running security audit...');
        try {
            this.exec('npm audit --audit-level=high', 'Security audit');
            this.log('✅ Security audit passed!', 'success');
        } catch (error) {
            this.log('⚠️ Security issues found. Review before production deployment.', 'warning');
        }
    }

    async healthCheck(url, service) {
        const fetch = (await import('node-fetch')).default;
        
        for (let i = 0; i < 10; i++) {
            try {
                const response = await fetch(url);
                if (response.ok) {
                    this.log(`✅ ${service} health check passed`, 'success');
                    return;
                }
            } catch (error) {
                this.log(`⏳ Waiting for ${service}... (${i + 1}/10)`, 'warning');
                await this.sleep(5000);
            }
        }
        
        throw new Error(`❌ ${service} health check failed`);
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    createDeploymentReport() {
        const report = {
            target: this.target,
            version: this.version,
            timestamp: this.timestamp,
            status: 'success',
            urls: {
                local: {
                    frontend: 'http://localhost:8080',
                    api: 'http://localhost:3001'
                }
            }
        };
        
        fs.writeFileSync('deployment-report.json', JSON.stringify(report, null, 2));
        this.log('📊 Deployment report saved to deployment-report.json', 'info');
    }

    async deploy() {
        try {
            this.log(`Starting deployment to: ${this.target}`, 'info');
            this.log(`Version: ${this.version}`, 'info');
            this.log(`Timestamp: ${this.timestamp}`, 'info');
            
            switch (this.target) {
                case 'local':
                    await this.deployLocal();
                    break;
                case 'heroku':
                    await this.deployHeroku();
                    break;
                case 'vercel':
                    await this.deployVercel();
                    break;
                case 'production':
                    await this.deployProduction();
                    break;
                default:
                    this.log(`Unknown target: ${this.target}`, 'error');
                    this.log('Available targets:', 'info');
                    Object.entries(DEPLOY_TARGETS).forEach(([key, desc]) => {
                        console.log(`  ${key}: ${desc}`);
                    });
                    process.exit(1);
            }
            
            this.createDeploymentReport();
            this.log('🎉 Deployment completed successfully!', 'success');
            
        } catch (error) {
            this.log(`Deployment failed: ${error.message}`, 'error');
            process.exit(1);
        }
    }
}

// Run deployment if called directly
if (require.main === module) {
    const deployer = new EchoVerseDeployer();
    deployer.deploy();
}

module.exports = EchoVerseDeployer;