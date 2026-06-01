const express = require('express');
const path = require('path');
const { Logger } = require('./utils/logger');
const { Database } = require('./database/db');
const { CredentialManager } = require('./utils/credential-manager');
const { ContentStrategyAgent } = require('./agents/content-strategy-agent');
const { ScriptWriterAgent } = require('./agents/script-writer-agent');
const { ThumbnailDesignerAgent } = require('./agents/thumbnail-designer-agent');
const { SEOOptimizerAgent } = require('./agents/seo-optimizer-agent');
const { ProductionManagementAgent } = require('./agents/production-management-agent');
const { PublishingSchedulingAgent } = require('./agents/publishing-scheduling-agent');
const { AnalyticsOptimizationAgent } = require('./agents/analytics-optimization-agent');
const { DailyAutomation } = require('./schedules/daily-automation');
const chalk = require('chalk');

class YouTubeAutomationAgent {
  constructor() {
    this.logger = new Logger('MainAgent');
    this.db = null;
    this.credentials = null;
    this.agents = {};
    this.app = express();
    this.isInitialized = false;
  }

  async initialize() {
    try {
      console.log(chalk.cyan.bold('\n🎬 YouTube Automation Agent v1.0'));
      console.log(chalk.gray('─'.repeat(50)));
      
      // Initialize database
      this.logger.info('Initializing database...');
      this.db = new Database();
      await this.db.initialize();
      
      // Load credentials
      this.logger.info('Loading credentials...');
      this.credentials = new CredentialManager();
      const credentialsValid = await this.credentials.validateAll();
      
      if (!credentialsValid) {
        console.log(chalk.yellow('\n⚠️  Some credentials are missing or invalid.'));
        console.log(chalk.yellow('Run: npm run credentials:setup'));
        return false;
      }
      
      // Initialize agents
      this.logger.info('Initializing agents...');
      await this.initializeAgents();
      
      // Setup API endpoints
      this.setupAPI();
      
      // Initialize scheduler
      this.logger.info('Setting up automation scheduler...');
      this.scheduler = new DailyAutomation(this.agents, this.db);
      await this.scheduler.initialize();
      
      this.isInitialized = true;
      this.logger.success('YouTube Automation Agent initialized successfully!');
      
      return true;
    } catch (error) {
      this.logger.error('Failed to initialize:', error);
      return false;
    }
  }

  async initializeAgents() {
    this.agents = {
      strategy: new ContentStrategyAgent(this.db, this.credentials),
      scriptWriter: new ScriptWriterAgent(this.db, this.credentials),
      thumbnailDesigner: new ThumbnailDesignerAgent(this.db, this.credentials),
      seoOptimizer: new SEOOptimizerAgent(this.db, this.credentials),
      production: new ProductionManagementAgent(this.db, this.credentials),
      publishing: new PublishingSchedulingAgent(this.db, this.credentials),
      analytics: new AnalyticsOptimizationAgent(this.db, this.credentials)
    };

    // Initialize each agent
    for (const [name, agent] of Object.entries(this.agents)) {
      await agent.initialize();
      this.logger.info(`✓ ${name} agent initialized`);
    }
  }

  setupAPI() {
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'dashboard')));
    
    // Main dashboard route
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'dashboard', 'index.html'));
    });
    
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        initialized: this.isInitialized,
        agents: Object.keys(this.agents),
        timestamp: new Date().toISOString()
      });
    });

    // Generation status — polled by dashboard every 2s during active generation
    this.generationStatus = { active: false, step: '' };
    this.app.get('/status', (req, res) => {
      res.json(this.generationStatus);
    });

    // Manual content generation
    this.app.post('/generate', async (req, res) => {
      try {
        const { topic, style, length } = req.body;
        const result = await this.generateContent(topic, style, length);
        res.json({ success: true, result });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // List generated scripts
    this.app.get('/content', async (req, res) => {
      try {
        const rows = await this.db.getAllRows('SELECT id, title, duration, tone, created_at FROM scripts ORDER BY created_at DESC LIMIT 20');
        res.json({ success: true, scripts: rows });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // View a single script's full content
    this.app.get('/content/:id', async (req, res) => {
      try {
        const row = await this.db.getRow('SELECT * FROM scripts WHERE id = ?', [req.params.id]);
        if (!row) return res.status(404).json({ error: 'Script not found' });
        row.hook = JSON.parse(row.hook || '{}');
        row.introduction = JSON.parse(row.introduction || '{}');
        row.mainContent = JSON.parse(row.main_content || '{}');
        row.conclusion = JSON.parse(row.conclusion || '{}');
        row.callToAction = JSON.parse(row.call_to_action || '{}');
        row.keywords = JSON.parse(row.keywords || '[]');
        res.json({ success: true, script: row });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get analytics
    this.app.get('/analytics', async (req, res) => {
      try {
        const analytics = await this.agents.analytics.getRecentAnalytics();
        res.json(analytics);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get upcoming schedule
    this.app.get('/schedule', async (req, res) => {
      try {
        const schedule = await this.db.getUpcomingSchedule();
        res.json(schedule);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // All videos (published + scheduled) for dashboard
    this.app.get('/videos', async (req, res) => {
      try {
        const rows = await this.db.getAllRows(
          `SELECT id, production_id, title, publish_time, status, youtube_id, youtube_url, published_at, created_at
           FROM publish_schedule ORDER BY created_at DESC`
        );
        res.json(rows);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Dashboard stats summary
    this.app.get('/stats', async (req, res) => {
      try {
        const [published, scheduled, scripts] = await Promise.all([
          this.db.getRow(`SELECT COUNT(*) as count FROM publish_schedule WHERE status = 'published'`),
          this.db.getRow(`SELECT COUNT(*) as count FROM publish_schedule WHERE status = 'scheduled'`),
          this.db.getRow(`SELECT COUNT(*) as count FROM scripts`)
        ]);
        res.json({
          published: published?.count || 0,
          scheduled: scheduled?.count || 0,
          scriptsGenerated: scripts?.count || 0
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Total view count across all published videos — fetched live from YouTube API
    this.app.get('/stats/views', async (req, res) => {
      try {
        const rows = await this.db.getAllRows(
          `SELECT youtube_id FROM publish_schedule WHERE status = 'published' AND youtube_id IS NOT NULL`
        );
        if (!rows.length) return res.json({ totalViews: 0, videoCount: 0 });

        const youtube = this.credentials.getYouTubeClient();
        const BATCH   = 50;
        let totalViews = 0;
        let videoCount = 0;

        for (let i = 0; i < rows.length; i += BATCH) {
          const ids = rows.slice(i, i + BATCH).map(r => r.youtube_id).join(',');
          const response = await youtube.videos.list({ part: 'statistics', id: ids });
          for (const item of response.data.items || []) {
            totalViews += parseInt(item.statistics?.viewCount || 0);
            videoCount++;
          }
        }

        res.json({ totalViews, videoCount });
      } catch (error) {
        res.status(500).json({ error: error.message, totalViews: 0 });
      }
    });

    // Manual publish
    this.app.post('/publish/:contentId', async (req, res) => {
      try {
        const { contentId } = req.params;
        const result = await this.agents.publishing.publishContent(contentId);
        res.json({ success: true, result });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });
  }

  setStatus(step) {
    if (this.generationStatus) this.generationStatus = { active: true, step };
  }

  async generateContent(topic = null, style = null, length = 'medium') {
    this.generationStatus = { active: true, step: 'Starting up…' };
    this.logger.info('Starting content generation pipeline...');

    try {
      // Step 1: Strategy
      this.setStatus('🔍 Finding a Reddit story…');
      const strategy = await this.agents.strategy.generateContentStrategy(topic);
      this.logger.info(`Strategy generated: ${strategy.topic}`);

      // Step 2: Script Writing
      this.setStatus('✍️ Writing the script…');
      const script = await this.agents.scriptWriter.generateScript(strategy);
      this.logger.info(`Script generated: ${script.title}`);

      // Step 3: Thumbnail Design
      this.setStatus('🎨 Generating AI thumbnail…');
      const thumbnail = await this.agents.thumbnailDesigner.generateThumbnail(script);
      this.logger.info('Thumbnail generated');

      // Step 4: SEO Optimization
      this.setStatus('🏷️ Optimising tags & description…');
      const seoData = await this.agents.seoOptimizer.optimize(script, strategy);
      this.logger.info('SEO optimization complete');

      // Step 5: Production Management (TTS + video assembly)
      this.setStatus('🎙️ Generating voiceover with Aoede…');
      const productionData = await this.agents.production.processContent({
        strategy,
        script,
        thumbnail,
        seo: seoData
      });
      this.logger.info('Production processing complete');

      // Step 6: Save to database
      this.setStatus('💾 Saving to database…');
      const contentId = await this.db.saveProductionData(productionData);
      this.logger.info(`Content saved with ID: ${contentId}`);

      // Step 7: Schedule for publishing
      const scheduleEntry = await this.agents.publishing.scheduleContent(productionData);
      this.logger.info(`Content scheduled: ${scheduleEntry.publishTime}`);

      // Step 8: Upload to YouTube
      this.setStatus('🚀 Uploading to YouTube…');
      try {
        const published = await this.agents.publishing.publishContent(productionData.id);
        this.logger.info(`Uploaded to YouTube: ${published.youtubeUrl}`);
        this.generationStatus = { active: false, step: '' };
        return {
          contentId,
          title: script.title,
          scheduledFor: productionData.scheduledPublishTime,
          youtubeUrl: published.youtubeUrl
        };
      } catch (uploadError) {
        this.logger.error(`YouTube upload failed: ${uploadError.message}`);
        this.generationStatus = { active: false, step: '' };
        return {
          contentId,
          title: script.title,
          scheduledFor: productionData.scheduledPublishTime,
          uploadError: uploadError.message
        };
      }
    } catch (err) {
      this.generationStatus = { active: false, step: '' };
      throw err;
    }
  }

  async start() {
    const initialized = await this.initialize();
    
    if (!initialized) {
      console.log(chalk.red('\n❌ Failed to initialize. Please check your configuration.'));
      process.exit(1);
    }
    
    const PORT = process.env.PORT || 3456;
    this.app.listen(PORT, () => {
      console.log(chalk.green(`\n✅ YouTube Automation Agent running on port ${PORT}`));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(chalk.white('📊 Dashboard: ') + chalk.cyan(`http://localhost:${PORT}`));
      console.log(chalk.white('🔧 API Health: ') + chalk.cyan(`http://localhost:${PORT}/health`));
      console.log(chalk.white('📅 Schedule: ') + chalk.cyan(`http://localhost:${PORT}/schedule`));
      console.log(chalk.white('📈 Analytics: ') + chalk.cyan(`http://localhost:${PORT}/analytics`));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(chalk.yellow('\n🤖 Automation is active. Content will be generated and posted daily.'));
    });
  }
}

// Start the agent
if (require.main === module) {
  const agent = new YouTubeAutomationAgent();
  agent.start().catch(error => {
    console.error(chalk.red('Fatal error:'), error);
    process.exit(1);
  });
}

module.exports = { YouTubeAutomationAgent };