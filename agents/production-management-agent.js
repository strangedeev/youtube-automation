const path = require('path');
const fs = require('fs').promises;
const { Logger } = require('../utils/logger');
const { AIVideoGenerator } = require('../utils/ai-video-generator');
const { GeminiTTS } = require('../utils/gemini-tts');
const { VideoAssembler } = require('../utils/video-assembler');
const { CaptionRenderer } = require('../utils/caption-renderer');
const { RedditCard } = require('../utils/reddit-card');

class ProductionManagementAgent {
  constructor(db, credentials) {
    this.db = db;
    this.credentials = credentials;
    this.logger = new Logger('ProductionManagement');
    this.pipeline = [];
    this.assets = new Map();
    this.aiVideoGenerator = new AIVideoGenerator(credentials);
    this.captionRenderer = new CaptionRenderer();
    this.redditCard = new RedditCard();
    this.channelName = credentials.credentials?.channel?.channelName || 'Storytime';

    const geminiKey = credentials.credentials?.gemini?.apiKey;
    if (geminiKey) {
      this.tts = new GeminiTTS(geminiKey);
      this.logger.info('Gemini TTS initialized');
    }
    const pexelsKey = credentials.credentials?.pexels?.apiKey;
    const pixabayKey = credentials.credentials?.pixabay?.apiKey;
    this.videoAssembler = new VideoAssembler(pexelsKey, pixabayKey);
  }

  async initialize() {
    this.logger.info('Initializing Production Management Agent...');
    await this.setupDirectories();
    await this.loadPipeline();
    return true;
  }

  async setupDirectories() {
    const dirs = [
      'data/production',
      'data/assets',
      'data/videos',
      'data/audio',
      'data/scripts',
      'temp/processing'
    ];

    for (const dir of dirs) {
      await fs.mkdir(path.join(__dirname, '..', dir), { recursive: true });
    }
  }

  async loadPipeline() {
    try {
      const pipeline = await this.db.getProductionPipeline();
      this.pipeline = pipeline || [];
    } catch (error) {
      this.logger.warn('No existing pipeline found, starting fresh');
    }
  }

  async processContent(contentData) {
    try {
      this.logger.info('Processing content for production...');
      
      const { strategy, script, thumbnail, seo } = contentData;
      
      // Create production entry
      const productionId = this.generateProductionId();
      
      const productionData = {
        id: productionId,
        strategy,
        script,
        thumbnail,
        seo,
        status: 'processing',
        assets: {
          script: await this.processScript(script),
          thumbnail: await this.processThumbnail(thumbnail),
          audio: null, // Will be generated later
          video: null, // Will be generated later
          captions: null // Will be generated later
        },
        timeline: {
          created: new Date().toISOString(),
          scriptReady: new Date().toISOString(),
          thumbnailReady: new Date().toISOString(),
          audioGenerated: null,
          videoGenerated: null,
          captionsGenerated: null,
          readyForUpload: null
        },
        scheduledPublishTime: this.calculatePublishTime(strategy),
        priority: this.calculatePriority(strategy),
        estimatedDuration: script.duration,
        createdAt: new Date().toISOString()
      };
      
      // Add to pipeline
      this.pipeline.push(productionData);
      
      // Save to database
      await this.db.saveProductionData(productionData);
      
      // Generate video content
      await this.generateVideoContent(productionData);
      
      // Generate audio narration
      await this.generateAudioNarration(productionData);
      
      // Generate captions
      await this.generateCaptions(productionData);
      
      // Final assembly
      await this.assembleVideo(productionData);
      
      // Mark as ready
      productionData.status = 'ready';
      productionData.timeline.readyForUpload = new Date().toISOString();
      
      await this.db.updateProductionData(productionData);
      
      this.logger.info(`Content processing complete: ${productionId}`);
      return productionData;
    } catch (error) {
      this.logger.error('Failed to process content:', error);
      throw error;
    }
  }

  generateProductionId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    const extra = Math.random().toString(36).substring(2, 15);
    return `prod_${timestamp}_${random}_${extra}`;
  }

  async processScript(script) {
    const scriptPath = path.join(__dirname, '..', 'data', 'scripts', `${Date.now()}_script.json`);
    
    // Create formatted script for TTS
    const ttsScript = this.formatScriptForTTS(script);
    
    // Save script files
    await fs.writeFile(scriptPath, JSON.stringify(script, null, 2));
    await fs.writeFile(
      scriptPath.replace('.json', '_tts.txt'), 
      ttsScript
    );
    
    return {
      originalPath: scriptPath,
      ttsPath: scriptPath.replace('.json', '_tts.txt'),
      duration: script.duration,
      sections: script.mainContent.sections.length
    };
  }

  formatScriptForTTS(script) {
    // If Gemini wrote a clean narration field, use it directly — no wrapping, no filler.
    // This is the word-for-word text the TTS should speak.
    if (script.narration && script.narration.trim().length > 20) {
      return script.narration.trim();
    }

    // Legacy fallback for older scripts without narration field
    let ttsText = '';

    // Hook
    if (script.hook?.text) {
      ttsText += `${script.hook.text}\n\n`;
    }

    // Introduction greeting only — skip the hardcoded filler lines
    if (script.introduction?.greeting) {
      ttsText += `${script.introduction.greeting}\n\n`;
    }

    // Main content — sections
    if (script.mainContent?.sections) {
      script.mainContent.sections.forEach(section => {
        // Skip section header labels — they read out badly as "Section 1: undefined"
        if (Array.isArray(section.content)) {
          section.content.forEach(line => {
            if (typeof line === 'string' && !line.startsWith('[')) {
              ttsText += `${line}\n`;
            }
          });
        } else if (section.steps) {
          section.steps.forEach(step => {
            ttsText += `${step.title}. ${step.description}\n`;
          });
        } else if (section.items) {
          section.items.forEach(item => {
            ttsText += `${item.title}. ${item.description}\n`;
          });
        } else if (typeof section.content === 'string') {
          ttsText += `${section.content}\n`;
        }
        ttsText += '\n';
      });
    }

    // Conclusion
    if (script.conclusion?.finalThought) {
      ttsText += `${script.conclusion.finalThought}\n\n`;
    }

    // CTA — just the subscribe line if set, skip the rest
    if (script.callToAction?.subscribe) {
      ttsText += `${script.callToAction.subscribe}\n`;
    }

    return ttsText.trim();
  }

  async processThumbnail(thumbnail) {
    try {
      // Try to generate AI thumbnail first
      const script = thumbnail.script || { title: 'Ethereal Dreamscript Video' };
      const aiThumbnail = await this.aiVideoGenerator.generateThumbnail(script, 'ethereal');
      
      return {
        path: aiThumbnail.path,
        originalPath: thumbnail.path,
        dimensions: aiThumbnail.dimensions,
        fileSize: aiThumbnail.fileSize,
        generatedWith: 'AI'
      };
    } catch (error) {
      this.logger.error('AI thumbnail generation failed:', error);
      
      // Fallback to original processing
      const productionThumbnailPath = path.join(
        __dirname, '..', 'data', 'assets', 
        `thumbnail_${Date.now()}.jpg`
      );
      
      if (thumbnail.path && await fs.access(thumbnail.path).then(() => true).catch(() => false)) {
        const originalBuffer = await fs.readFile(thumbnail.path);
        await fs.writeFile(productionThumbnailPath, originalBuffer);
      } else {
        // Create placeholder
        await fs.writeFile(productionThumbnailPath + '.placeholder', 'Thumbnail placeholder');
      }
      
      return {
        path: productionThumbnailPath,
        originalPath: thumbnail.path,
        dimensions: thumbnail.dimensions || { width: 1792, height: 1024 },
        fileSize: thumbnail.fileSize || 0
      };
    }
  }

  calculatePublishTime(strategy) {
    // Use strategy's recommended time or calculate optimal time
    if (strategy.bestPublishTime) {
      return strategy.bestPublishTime;
    }
    
    // Default: next optimal publishing window
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    tomorrow.setHours(14, 0, 0, 0); // 2 PM default
    
    return tomorrow.toISOString();
  }

  calculatePriority(strategy) {
    let priority = 50; // Base priority
    
    // Adjust based on estimated views
    if (strategy.estimatedViews > 100000) priority += 30;
    else if (strategy.estimatedViews > 50000) priority += 20;
    else if (strategy.estimatedViews > 10000) priority += 10;
    
    // Adjust based on trend score
    if (strategy.competitorAnalysis && strategy.competitorAnalysis.length > 0) {
      priority += 10;
    }
    
    // Time sensitivity
    const hoursUntilPublish = (new Date(strategy.bestPublishTime) - new Date()) / (1000 * 60 * 60);
    if (hoursUntilPublish < 24) priority += 20;
    else if (hoursUntilPublish < 48) priority += 10;
    
    return Math.min(100, priority);
  }

  async generateVideoContent(productionData) {
    this.logger.info('Generating AI video content...');
    
    try {
      const { strategy, script } = productionData;
      
      // Generate visual assets using DALL-E
      const visualPrompts = this.createVisualPromptsFromScript(script);
      const visualAssets = [];
      
      for (const prompt of visualPrompts) {
        const assets = await this.aiVideoGenerator.generateVisualAssets(prompt, 'ethereal', 1);
        visualAssets.push(...assets);
      }
      
      productionData.assets.video = {
        visualAssets: visualAssets,
        duration: productionData.estimatedDuration,
        format: 'mp4',
        resolution: '1920x1080',
        fps: 30,
        generatedWith: 'AI'
      };
      
      productionData.timeline.videoGenerated = new Date().toISOString();
      
      return visualAssets;
    } catch (error) {
      this.logger.error('AI video content generation failed:', error);
      // Fallback to placeholder
      return await this.createVideoElements(productionData);
    }
  }

  async createVideoElements(productionData) {
    const { script } = productionData;
    const elements = [];
    
    // Title slide
    elements.push({
      type: 'title_slide',
      content: script.title,
      duration: 3,
      style: 'modern',
      animation: 'fade_in'
    });
    
    // Content sections
    if (script.mainContent && script.mainContent.sections) {
      script.mainContent.sections.forEach((section, index) => {
        // Section title
        elements.push({
          type: 'section_title',
          content: section.title,
          duration: 2,
          style: 'minimal',
          animation: 'slide_in'
        });
        
        // Content visuals
        if (section.type === 'list_items' && section.items) {
          section.items.forEach(item => {
            elements.push({
              type: 'list_item',
              content: {
                number: item.number,
                title: item.title,
                description: item.description
              },
              duration: 15,
              style: 'countdown',
              animation: 'zoom_in'
            });
          });
        } else if (section.type === 'solution_steps' && section.steps) {
          section.steps.forEach(step => {
            elements.push({
              type: 'step',
              content: {
                number: step.number,
                title: step.title,
                description: step.description
              },
              duration: 20,
              style: 'tutorial',
              animation: 'step_by_step'
            });
          });
        } else {
          // Generic content slide
          elements.push({
            type: 'content_slide',
            content: section.title,
            duration: section.duration || 30,
            style: 'informative',
            animation: 'fade_transition'
          });
        }
      });
    }
    
    // Conclusion slide
    elements.push({
      type: 'conclusion',
      content: 'Key Takeaways',
      duration: 5,
      style: 'summary',
      animation: 'reveal'
    });
    
    // Subscribe reminder
    elements.push({
      type: 'subscribe_reminder',
      content: 'Subscribe for More!',
      duration: 3,
      style: 'call_to_action',
      animation: 'bounce'
    });
    
    return elements;
  }

  async generateAudioNarration(productionData) {
    this.logger.info('Generating audio narration with Gemini TTS...');

    if (!this.tts) {
      this.logger.warn('Gemini TTS not available, simulating audio');
      return await this.simulateAudioGeneration(productionData);
    }

    try {
      const audioPathBase = path.join(__dirname, '..', 'data', 'audio', `${productionData.id}_narration.wav`);
      const ttsText = await fs.readFile(productionData.assets.script.ttsPath, 'utf8');

      const audioPath = await this.tts.generate(ttsText, audioPathBase);

      productionData.assets.audio = {
        path: audioPath,
        duration: productionData.estimatedDuration,
        format: 'mp3',
        generatedWith: 'Gemini TTS',
        quality: 'high'
      };
      productionData.timeline.audioGenerated = new Date().toISOString();
      return audioPath;
    } catch (error) {
      // Extract the real error — Axios errors hide details in error.response.data
      const status  = error.response?.status;
      const apiMsg  = error.response?.data?.error?.message || error.response?.data?.message || '';
      const fullMsg = apiMsg || error.message || JSON.stringify(error.response?.data || '');
      this.logger.error(`Gemini TTS failed [${status || 'no-status'}]: ${fullMsg}`);

      // If rate limited, throw so the retry wrapper in daily-automation can back off and retry
      if (status === 429 || fullMsg.includes('429')) {
        throw new Error(`TTS rate limited (429) — will retry: ${fullMsg}`);
      }
      // For other errors (network blip etc), fall back to simulation
      return await this.simulateAudioGeneration(productionData);
    }
  }

  async simulateTTSGeneration(scriptPath, outputPath, config) {
    // This is a simulation - in production, you'd integrate with actual TTS services
    this.logger.info(`Simulating TTS generation: ${config.voice}`);
    
    // Create a placeholder audio file reference
    await fs.writeFile(outputPath + '.info', JSON.stringify({
      message: 'TTS audio would be generated here',
      config,
      timestamp: new Date().toISOString()
    }, null, 2));
  }

  async generateCaptions(productionData) {
    this.logger.info('Generating captions...');
    
    const captionsPath = path.join(__dirname, '..', 'data', 'captions', `${productionData.id}_captions.srt`);
    
    // Generate SRT captions based on script timing
    const captions = await this.createSRTCaptions(productionData);
    
    await fs.mkdir(path.dirname(captionsPath), { recursive: true });
    await fs.writeFile(captionsPath, captions);
    
    productionData.assets.captions = {
      path: captionsPath,
      format: 'srt',
      language: 'en',
      autoGenerated: true
    };
    
    productionData.timeline.captionsGenerated = new Date().toISOString();
    
    return captionsPath;
  }

  async createSRTCaptions(productionData) {
    const { script } = productionData;
    let srt = '';
    let captionIndex = 1;
    let currentTime = 0;
    
    // Helper function to format time for SRT
    const formatSRTTime = (seconds) => {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);
      const ms = Math.floor((seconds % 1) * 1000);
      
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
    };
    
    // Process script sections for captions
    const processText = (text, startTime, duration) => {
      const words = text.split(' ');
      const wordsPerCaption = 8; // Optimal words per caption
      
      for (let i = 0; i < words.length; i += wordsPerCaption) {
        const captionWords = words.slice(i, i + wordsPerCaption);
        const captionDuration = (duration / Math.ceil(words.length / wordsPerCaption));
        const captionStartTime = startTime + (i / words.length) * duration;
        const captionEndTime = captionStartTime + captionDuration;
        
        srt += `${captionIndex}\n`;
        srt += `${formatSRTTime(captionStartTime)} --> ${formatSRTTime(captionEndTime)}\n`;
        srt += `${captionWords.join(' ')}\n\n`;
        
        captionIndex++;
      }
    };
    
    // Hook
    if (script.hook && script.hook.text) {
      processText(script.hook.text, currentTime, 5);
      currentTime += 5;
    }
    
    // Introduction
    if (script.introduction) {
      const introText = `${script.introduction.greeting} ${script.introduction.topicIntro} ${script.introduction.valueProposition}`;
      processText(introText, currentTime, 15);
      currentTime += 15;
    }
    
    // Main content
    if (script.mainContent && script.mainContent.sections) {
      script.mainContent.sections.forEach(section => {
        let sectionText = '';
        
        if (Array.isArray(section.content)) {
          sectionText = section.content.filter(line => 
            typeof line === 'string' && !line.startsWith('[')
          ).join(' ');
        } else if (section.steps) {
          sectionText = section.steps.map(step => 
            `${step.title}. ${step.description}`
          ).join(' ');
        } else if (section.items) {
          sectionText = section.items.map(item => 
            `Number ${item.number}: ${item.title}. ${item.description}`
          ).join(' ');
        } else if (typeof section.content === 'string') {
          sectionText = section.content;
        }
        
        if (sectionText) {
          processText(sectionText, currentTime, section.duration || 60);
          currentTime += section.duration || 60;
        }
      });
    }
    
    // Conclusion
    if (script.conclusion) {
      const conclusionText = (Array.isArray(script.conclusion.recap) ? script.conclusion.recap.join(' ') : '') + ' ' + (script.conclusion.finalThought || '');
      processText(conclusionText, currentTime, 30);
      currentTime += 30;
    }
    
    return srt;
  }

  async assembleVideo(productionData) {
    this.logger.info('Assembling video with ffmpeg...');

    // Skip if audio is simulated (no real audio file)
    if (productionData.assets.audio?.simulated) {
      this.logger.warn('Audio is simulated — skipping real video assembly');
      return await this.simulateVideoAssembly(productionData);
    }

    try {
      const title = productionData.script?.title || 'Vid Shock';
      const topic = productionData.strategy?.topic || title;
      const bgBasePath = path.join(__dirname, '..', 'data', 'assets', `${productionData.id}_bg.jpg`);
      const finalVideoPath = path.join(__dirname, '..', 'data', 'videos', `${productionData.id}_final.mp4`);

      // 1. Prepare background (random gameplay/lifestyle clip)
      const bgResult = await this.videoAssembler.createBackground(topic, title, bgBasePath);
      this.logger.info(`Background ready (${bgResult.type})`);

      // 1b. Build Phase 2 overlays — captions, reddit card, music bed.
      // All optional: if any step fails the video still assembles without it.
      const audioPath = productionData.assets.audio.path;
      const capWorkDir = path.join(__dirname, '..', 'data', 'assets', `${productionData.id}_cap`);
      const extras = {};

      // Captions (whisper → transparent caption track)
      try {
        const dur = await this.videoAssembler.getAudioDuration(audioPath);
        const cap = await this.captionRenderer.generate(audioPath, capWorkDir, productionData.id, dur);
        if (cap) extras.captionTrack = cap.trackPath;
      } catch (e) { this.logger.warn(`Captions skipped: ${e.message}`); }

      // Reddit intro card (from the script's cardText)
      try {
        const cardText = productionData.script?.cardText;
        if (cardText) {
          const cardPath = path.join(__dirname, '..', 'data', 'assets', `${productionData.id}_card.png`);
          await this.redditCard.render(cardText, this.channelName, cardPath);
          extras.cardPath = cardPath;
          extras.cardDuration = 5;
        }
      } catch (e) { this.logger.warn(`Reddit card skipped: ${e.message}`); }

      // Background music bed (any .mp3 in data/music/, picked at random)
      try {
        const musicDir = path.join(__dirname, '..', 'data', 'music');
        const tracks = (await fs.readdir(musicDir).catch(() => []))
          .filter(f => /\.(mp3|m4a|wav|aac)$/i.test(f));
        if (tracks.length) {
          extras.musicPath = path.join(musicDir, tracks[Math.floor(Math.random() * tracks.length)]);
          this.logger.info(`Background music: ${path.basename(extras.musicPath)}`);
        }
      } catch (_) {}

      // 2. Assemble final video with all overlays
      const result = await this.videoAssembler.assemble(
        bgResult,
        audioPath,
        finalVideoPath,
        extras
      );

      // Clean up caption working files
      await fs.rm(capWorkDir, { recursive: true, force: true }).catch(() => {});

      productionData.assets.finalVideo = {
        path: finalVideoPath,
        fileSize: result.size,
        duration: `${Math.round(result.duration / 60)}:${String(Math.round(result.duration % 60)).padStart(2, '0')}`,
        resolution: '1920x1080',
        format: 'mp4'
      };
      productionData.timeline.videoGenerated = new Date().toISOString();
      this.logger.info(`Video assembled: ${(result.size / 1024 / 1024).toFixed(1)} MB`);

      // Generate custom thumbnail — gameplay frame + Hindi title text overlay.
      // The video itself stays pure gameplay; this is a separate 1280×720 image
      // uploaded to YouTube via thumbnails.set() right after the video upload.
      const thumbnailPath = path.join(__dirname, '..', 'data', 'assets', `${productionData.id}_thumb.jpg`);
      const gameplaySource = bgResult.gameplayPath || finalVideoPath;
      const thumbResult = await this.videoAssembler.generateThumbnail(
        gameplaySource,
        title,
        thumbnailPath
      );
      if (thumbResult) {
        productionData.assets.thumbnail = {
          path: thumbResult,
          dimensions: { width: 1280, height: 720 },
          format: 'jpg'
        };
        this.logger.info('Custom thumbnail ready');
      }

      return finalVideoPath;
    } catch (error) {
      this.logger.error('Video assembly failed:', error.message);
      return await this.simulateVideoAssembly(productionData);
    }
  }

  async simulateVideoRendering(instructions) {
    this.logger.info('Simulating video rendering...');
    
    // Create a placeholder that indicates video would be rendered
    await fs.writeFile(instructions.outputPath + '.placeholder', JSON.stringify({
      message: 'Final video would be rendered here',
      instructions,
      timestamp: new Date().toISOString()
    }, null, 2));
  }

  async getPipelineStatus() {
    return this.pipeline.map(item => ({
      id: item.id,
      title: item.script?.title || 'Untitled',
      status: item.status,
      priority: item.priority,
      scheduledPublishTime: item.scheduledPublishTime,
      progress: this.calculateProgress(item)
    }));
  }

  calculateProgress(productionData) {
    const milestones = [
      'scriptReady',
      'thumbnailReady',
      'audioGenerated',
      'videoGenerated',
      'captionsGenerated',
      'readyForUpload'
    ];
    
    const completed = milestones.filter(milestone => 
      productionData.timeline[milestone] !== null
    ).length;
    
    return Math.round((completed / milestones.length) * 100);
  }

  async getNextReadyContent() {
    const ready = this.pipeline
      .filter(item => item.status === 'ready')
      .sort((a, b) => b.priority - a.priority);
    
    return ready[0] || null;
  }

  // Helper method to create visual prompts from script content
  createVisualPromptsFromScript(script) {
    const prompts = [];
    
    // Title prompt
    prompts.push(`${script.title}, ethereal storytelling, mystical background`);
    
    // Content-based prompts
    if (script.mainContent && script.mainContent.sections) {
      script.mainContent.sections.forEach(section => {
        if (section.title) {
          prompts.push(`${section.title}, ethereal dreamscape, creative visualization`);
        }
      });
    }
    
    // Ensure we have at least 3 prompts
    while (prompts.length < 3) {
      prompts.push('ethereal dreamscape, mystical storytelling, creative visualization');
    }
    
    return prompts.slice(0, 5); // Limit to 5 for cost control
  }

  // Fallback simulation methods
  async simulateAudioGeneration(productionData) {
    const audioPath = path.join(__dirname, '..', 'data', 'audio', `${productionData.id}_narration.mp3`);
    
    await fs.writeFile(audioPath + '.info', JSON.stringify({
      message: 'AI TTS audio would be generated here',
      timestamp: new Date().toISOString()
    }, null, 2));
    
    productionData.assets.audio = {
      path: audioPath + '.info',
      duration: productionData.estimatedDuration,
      format: 'mp3',
      simulated: true
    };
    
    return audioPath + '.info';
  }

  async simulateVideoAssembly(productionData) {
    const finalVideoPath = path.join(__dirname, '..', 'data', 'videos', `${productionData.id}_final.mp4`);
    
    const assemblyInstructions = {
      message: 'AI video would be assembled here',
      assets: productionData.assets,
      timestamp: new Date().toISOString()
    };
    
    await fs.writeFile(
      finalVideoPath + '.assembly.json',
      JSON.stringify(assemblyInstructions, null, 2)
    );
    
    productionData.assets.finalVideo = {
      path: finalVideoPath + '.assembly.json',
      fileSize: 0,
      duration: productionData.estimatedDuration,
      simulated: true
    };
    
    return finalVideoPath + '.assembly.json';
  }
}

module.exports = { ProductionManagementAgent };