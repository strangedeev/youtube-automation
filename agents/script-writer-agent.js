const { Logger } = require('../utils/logger');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { NIMClient } = require('../utils/nim-client');

class ScriptWriterAgent {
  constructor(db, credentials) {
    this.db = db;
    this.credentials = credentials;
    this.logger = new Logger('ScriptWriter');
    this.templates = this.loadTemplates();

    // NIM (Llama 4 Maverick) is the primary writer for original stories —
    // stronger emotional/dramatic prose than Gemini, and free.
    const nvidiaKey = credentials.credentials?.nvidia?.apiKey;
    if (nvidiaKey) {
      this.nim = new NIMClient(nvidiaKey);
      this.logger.info('NVIDIA NIM (Llama 4 Maverick) initialized for story generation');
    } else {
      this.logger.warn('NVIDIA API key not found — falling back to Gemini for stories');
    }

    // Gemini kept as a fallback writer and for legacy modes
    const geminiKey = credentials.credentials?.gemini?.apiKey;
    if (geminiKey) {
      const genAI = new GoogleGenerativeAI(geminiKey);
      this.gemini = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
      this.logger.info('Gemini 2.5 Flash Lite initialized as fallback');
    } else {
      this.logger.warn('Gemini API key not found - using template-based generation');
    }
  }

  // Kept for fallback template methods — always returns null so templates are used without extra quota
  async callGemini(prompt) { return null; }

  // Write a complete original story from a premise using NIM (Llama 4 Maverick).
  // Returns the full package: spoken hook line, reddit-card question, narration,
  // and 3 title options. Returns null on failure so the caller can fall back.
  async generateOriginalStory(strategy) {
    const premise  = strategy.premise || strategy.topic;
    const category = strategy.category || 'drama';
    // Tone/style is user-configurable via config/topics.json → contentStyle.
    // Default matches the original dramatic first-person story format.
    const contentStyle = strategy.contentStyle ||
      'gripping, emotional first-person stories that feel completely real — like a true confession someone posted online';

    const prompt = `You are the head writer for a faceless YouTube Shorts channel. The channel's content style is: ${contentStyle}.

PREMISE / TOPIC TO BUILD FROM: "${premise}"
CATEGORY: ${category}

Write a complete original story package. Return ONLY valid JSON (no markdown):

{
  "hookLine": "A punchy 4-8 word spoken opener that states the bombshell flat-out. This is the FIRST thing the viewer hears and sees. Examples: 'My girlfriend is a cheater.' / 'My parents are gold diggers.' / 'My best friend betrayed me.' Make it brutal and specific to THIS story.",
  "cardText": "An AskReddit-style question that this story answers, phrased to make people stop scrolling. Examples: 'What's the worst betrayal you've ever experienced?' / 'When did you realize a family member was using you?' One sentence, ends with a question mark.",
  "narration": "The full story, 250-290 words, first person, spoken prose for TTS. It MUST start with the exact hookLine, then drop straight into the action — no 'so', no 'okay so', no warm-up. Follow this beat structure so every sentence pulls the viewer forward: (1) the hook bombshell, (2) quick setup of who and what is at stake, (3) the first crack — something feels wrong, (4) the escalation — it gets worse, the stakes rise, (5) the confrontation or discovery — the shocking peak, (6) a STRONG ending where the narrator DOES something or something HAPPENS: a confrontation, a consequence, a reveal, vindication, or revenge. Conversational, like telling your best friend. Real details: ages, names, exact amounts, what was said word-for-word.",
  "titles": [
    "A cliffhanger statement that cuts off before the payoff, e.g. 'She Said She Was Working Late. Then I Saw The Receipt.'",
    "A first-person bombshell, e.g. 'My Wife's Best Friend Told Me Everything.'",
    "A question that creates an open loop, e.g. 'How Do You Forgive Someone Who Did This?'"
  ]
}

STORY QUALITY RULES:
- 250-290 words. This is roughly 2 minutes spoken — long enough for a full arc with real escalation. Reach this length by ADDING STORY BEATS (more escalation, a second twist, a vivid detail), NEVER by padding with filler, repetition, or reflection. If a sentence does not raise tension or move the story, cut it.
- RETENTION IS THE ONLY GOAL. Every sentence must make the viewer need to hear the next one. The moment the story gets predictable or slow, they swipe away.
- One clear conflict, one clear antagonist, one satisfying TURN at the end.
- THE ENDING IS EVERYTHING. Never end on the narrator blaming themselves, "questioning everything", or a reflective "I learned" wrap-up — that is boring and viewers click away. Instead END ON ACTION OR CONSEQUENCE: they confront the person, walk away with their head high, the antagonist gets caught or loses something, or a final shocking reveal lands. The viewer must finish feeling a jolt — vindication, shock, or satisfaction.
- Specific beats real. "She transferred $14,000" beats "she took money".
- No hashtags, no emojis, no Reddit jargon (AITA, NTA, OP).

TITLE RULES:
- Never start a title with "I".
- No hashtags, no emojis, no clickbait punctuation spam.
- Each title under 70 characters.`;

    try {
      const parsed = await this.nim.generateJSON(prompt, { temperature: 0.95, maxTokens: 1400 });

      if (!parsed.narration || !parsed.titles) {
        this.logger.warn('NIM returned incomplete story package');
        return null;
      }

      // Ensure the narration opens with the hook line (so TTS speaks it first)
      let narration = parsed.narration.trim();
      const hookLine = (parsed.hookLine || '').trim();
      if (hookLine && !narration.toLowerCase().startsWith(hookLine.toLowerCase().slice(0, 12))) {
        narration = `${hookLine} ${narration}`;
      }

      parsed.narration = narration;
      parsed.hook      = hookLine || narration.split('.')[0] + '.';
      parsed.hookLine  = hookLine;
      parsed.cardText  = (parsed.cardText || '').trim();
      parsed.category  = category;

      if (Array.isArray(parsed.titles) && parsed.titles.length > 0) {
        parsed.title = this.pickBestTitle(parsed.titles);
        this.logger.info(`Original story written [${category}]`);
        this.logger.info(`Hook line: "${parsed.hookLine}"`);
        this.logger.info(`Card: "${parsed.cardText}"`);
        this.logger.info(`Titles: ${parsed.titles.join(' | ')}`);
        this.logger.info(`Selected title: ${parsed.title}`);
      }

      return parsed;
    } catch (err) {
      this.logger.error('NIM original story generation failed:', err.message);
      return null;
    }
  }

  // Single call that generates the entire script package.
  async generateFullScriptWithGemini(strategy) {

    // ── ORIGINAL STORY MODE (primary) ────────────────────────────────────────
    // Write a complete original story from a premise — the model the winning
    // channels in this niche actually use. NIM (Llama 4 Maverick) handles the
    // emotional, dark, cliffhanger tone far better than Gemini.
    if (strategy.isOriginal && this.nim) {
      const result = await this.generateOriginalStory(strategy);
      if (result) return result;
      this.logger.warn('NIM original story failed — falling back to Gemini');
      // fall through to Gemini-based generation below if NIM fails
    }

    if (!this.gemini) return null;

    // ── REDDIT STORY MODE ────────────────────────────────────────────────────
    if (strategy.fullStory) {
      const prompt = `You are rewriting a Reddit story as a YouTube Shorts narration for a brainrot gameplay channel.

Original post from r/${strategy.subreddit}:
---
${strategy.fullStory}
---

TASK:
Rewrite this as a natural, gripping first-person narration for a YouTube Short. Target 250-350 words — that is roughly 2 to 2.5 minutes of speech, which keeps it within YouTube's 3-minute Shorts limit. Do NOT exceed 380 words under any circumstances.

If the story is longer than this, distil it: keep the core conflict, the key twist or confrontation, and the resolution. Cut background padding, repeated details, and tangents. Every sentence must earn its place.

RULES:
- Open with a hook that drops the viewer straight into the conflict. No warm-up, no "so basically", no "okay so". The first sentence must create an unresolved question the viewer cannot leave without answering.
- Sound like someone telling their best friend the story — conversational, fast-paced, a little dramatic.
- Remove all Reddit formatting: no "AITA", "NTA", "YTA", "OP", "Edit:", asterisks, line breaks mid-sentence.
- Replace usernames with natural descriptions ("my coworker", "my sister", "my landlord").
- Keep real details: ages, relationships, what was said word-for-word if it matters.
- End naturally on the resolution or with "Follow for more" if it lands better.
- No filler, no moralising, no "I learned that day" wrap-ups — just the raw story.

TITLE RULES (critical):
- Cliffhanger format that creates an open loop the viewer must close.
- Never start with "I" — start with the situation or the twist.
- No hashtags, no emojis in the title.

Return ONLY valid JSON, no markdown:
{
  "titles": [
    "Title 1 — unresolved conflict (e.g. 'She Reported Me To HR For Something I Didn\\'t Do')",
    "Title 2 — outcome teaser (e.g. 'I Got My Coworker Fired. She Deserved It.')",
    "Title 3 — question format (e.g. 'Was I Wrong To Expose My Sister At Her Own Wedding?')"
  ],
  "narration": "Full word-for-word narration, complete story, conversational prose, exactly as it will be spoken by TTS.",
  "hook": "The first sentence of the narration, copied exactly from the narration field"
}`;

      try {
        const result = await this.gemini.generateContent(prompt);
        const text = result.response.text().trim()
          .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed.titles) && parsed.titles.length > 0) {
          parsed.title = this.pickBestTitle(parsed.titles);
          this.logger.info(`Reddit story titles: ${parsed.titles.join(' | ')}`);
          this.logger.info(`Selected: ${parsed.title}`);
        }
        return parsed;
      } catch (error) {
        this.logger.error('Gemini Reddit script failed:', error.message);
        return null;
      }
    }

    // ── FACT / SHOCKING TOPIC MODE ───────────────────────────────────────────
    const prompt = `You are writing a 20-second English YouTube Shorts narration. Goal: stop a half-asleep scroller in the first second and keep them watching for 20 seconds.

Topic: "${strategy.topic}"

STRUCTURE:
1. HOOK (first sentence) — No warm-up, no context-setting. Drop them straight into something that makes their brain say "wait, what?" Make it personal ("your", "you") or deeply unsettling. Do NOT name the topic.
2. REVEAL — One sentence with the actual shocking fact.
3. TWIST — The angle that makes it even more jaw-dropping. A real number, real name, or unexpected consequence.
4. END — Exactly this: "Follow for more."

HARD RULES:
- 55-65 words TOTAL. That is 20 seconds. Not one word more.
- ONE idea only. No sub-points, no lists, no extra context.
- Real numbers and real names — never be vague.
- No intros: "Hey guys", "Today", "Did you know", "In this video" — all forbidden.
- Flowing conversational prose — written exactly how it will be spoken. Goes straight to text-to-speech.

HOOK EXAMPLES (match this energy):
❌ WEAK: "Did you know the human brain is a really interesting organ?"
✅ STRONG: "Your brain is lying to you right now and there's nothing you can do about it."

❌ WEAK: "Today we're going to talk about the Chernobyl disaster."
✅ STRONG: "In 1986, engineers pressed the emergency stop button on a runaway nuclear reactor — and the button itself caused the explosion."

Return ONLY valid JSON, no markdown, no code blocks:
{
  "titles": [
    "Title option 1 — curiosity gap (e.g. 'The Button That Made Chernobyl Worse')",
    "Title option 2 — shocking number or scale (e.g. '3 Seconds. 30,000x Power. 1 Button.')",
    "Title option 3 — personal/reframe (e.g. 'Your Brain Has Been Lying To You Your Entire Life')"
  ],
  "narration": "Full word-for-word narration, 55-65 words, flowing prose, exactly as it will be spoken.",
  "hook": "The first sentence of the narration, copied exactly from the narration field"
}`;

    try {
      const result = await this.gemini.generateContent(prompt);
      const text = result.response.text().trim()
        .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
      const parsed = JSON.parse(text);

      // Pick the best title from the 3 options
      if (Array.isArray(parsed.titles) && parsed.titles.length > 0) {
        parsed.title = this.pickBestTitle(parsed.titles);
        this.logger.info(`Title options: ${parsed.titles.join(' | ')}`);
        this.logger.info(`Selected title: ${parsed.title}`);
      }

      return parsed;
    } catch (error) {
      this.logger.error('Gemini script generation failed, using templates:', error.message, error.status || '');
      return null;
    }
  }

  pickBestTitle(titles) {
    // English curiosity-gap triggers — these stop the scroll
    const powerWords = [
      'never', 'actually', 'truth', 'real', 'secret', 'dark', 'hidden', 'exposed',
      'killed', 'destroyed', 'impossible', 'insane', 'shocking', 'banned', 'deadly',
      'why', 'how', 'what', 'worst', 'dangerous', 'terrifying', 'disturbing'
    ];

    const scored = titles.map(title => {
      let score = 0;
      const lower = title.toLowerCase();

      // Hard penalty for hashtags — never allowed in title
      if (title.includes('#')) score -= 20;

      // Reward numbers (specificity = credibility)
      if (/\d/.test(title)) score += 4;

      // Reward power words
      powerWords.forEach(w => { if (lower.includes(w)) score += 2; });

      // Reward curiosity gap patterns ("The X That Did Y", "Why X Actually...")
      if (/\bthe\b.+\bthat\b|\bwhy\b|\bhow\b|\bwhat\b/i.test(title)) score += 3;

      // Reward question marks (open loop = watch to find out)
      if (title.includes('?')) score += 3;

      // Penalise if too long (title gets cut off in feed)
      if (title.length > 60) score -= 3;
      if (title.length < 15) score -= 2;

      return { title, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // Strip any stray hashtags just in case
    return scored[0].title.replace(/#\S+/g, '').trim();
  }

  async initialize() {
    this.logger.info('Initializing Script Writer Agent...');
    return true;
  }

  loadTemplates() {
    return {
      tutorial: {
        structure: ['hook', 'introduction', 'problem', 'solution_steps', 'demonstration', 'recap', 'cta'],
        tone: 'educational',
        pacing: 'moderate'
      },
      explainer: {
        structure: ['hook', 'question', 'background', 'explanation', 'examples', 'implications', 'summary', 'cta'],
        tone: 'informative',
        pacing: 'steady'
      },
      list: {
        structure: ['hook', 'introduction', 'list_items', 'bonus_item', 'summary', 'cta'],
        tone: 'engaging',
        pacing: 'quick'
      },
      review: {
        structure: ['hook', 'introduction', 'overview', 'pros', 'cons', 'comparison', 'verdict', 'cta'],
        tone: 'analytical',
        pacing: 'detailed'
      },
      story: {
        structure: ['hook', 'setup', 'conflict', 'journey', 'climax', 'resolution', 'lesson', 'cta'],
        tone: 'narrative',
        pacing: 'dynamic'
      }
    };
  }

  async generateScript(strategy) {
    try {
      this.logger.info(`Generating script for: ${strategy.topic}`);

      const template = this.templates[strategy.contentType.toLowerCase()] || this.templates.explainer;

      // Try single Gemini call first (uses only 1 of 20 daily quota)
      const ai = await this.generateFullScriptWithGemini(strategy);

      let hook, introduction, mainContent, conclusion, cta, title;

      if (ai) {
        this.logger.info('Full script package generated successfully');
        title = ai.title;
        hook = { type: 'ai', text: ai.hook || ai.narration.split('.')[0] + '.', duration: '0:00-0:05' };
        // Keep these empty — the narration field is the single source of truth for TTS
        introduction = { greeting: '', topicIntro: '', valueProposition: '', credibility: '', duration: '0:05-0:20' };
        mainContent = {
          sections: [{ type: 'ai_generated', content: ai.narration }],
          totalDuration: '0:00-1:00'
        };
        conclusion = { type: 'conclusion', finalThought: '', duration: '0 seconds' };
        cta = { type: 'call_to_action', subscribe: '', like: '', comment: '', nextVideo: '', duration: '0 seconds' };
      } else {
        // Fallback to templates
        title = await this.generateTitle(strategy);
        hook = await this.generateHook(strategy);
        introduction = await this.generateIntroduction(strategy);
        mainContent = await this.generateMainContent(strategy, template);
        conclusion = await this.generateConclusion(strategy);
        cta = await this.generateCTA(strategy);
      }

      // Assemble complete script
      const script = {
        title,
        hook,
        introduction,
        mainContent,
        conclusion,
        callToAction: cta,
        // Clean narration field — this is the single source of truth for TTS.
        // If Gemini generated it, use it directly. Otherwise derive from sections.
        narration: ai?.narration || null,
        // Original-story extras — used by video overlay (Phase 2) + description
        hookLine: ai?.hookLine || null,
        cardText: ai?.cardText || null,
        category: ai?.category || strategy.category || null,
        duration: this.estimateDuration(mainContent),
        tone: template.tone,
        pacing: template.pacing,
        keywords: strategy.keywords,
        metadata: {
          strategy: strategy,
          generatedAt: new Date().toISOString(),
          version: '1.0'
        }
      };

      // Format for readability
      script.fullScript = this.formatFullScript(script);
      
      // Save to database
      await this.db.saveScript(script);
      
      this.logger.info(`Script generated: ${script.title}`);
      return script;
    } catch (error) {
      this.logger.error('Failed to generate script:', error);
      throw error;
    }
  }

  async generateTitle(strategy) {
    const aiTitle = await this.callGemini(
      `Generate a single viral YouTube video title for a video about "${strategy.topic}".
       Content type: ${strategy.contentType}. Target audience: general audience of all ages interested in viral, trending, and entertaining content.
       The title must be attention-grabbing, under 70 characters, and optimized for clicks.
       Return ONLY the title text, no quotes, no explanation.`
    );
    if (aiTitle) return aiTitle;

    if (strategy.contentType === 'Tutorial') return `How to ${strategy.topic}: Step-by-Step Guide`;
    if (strategy.contentType === 'List') return `Top 10 ${strategy.topic} Tips You Need to Know`;
    if (strategy.contentType === 'Review') return `${strategy.topic} Review: Is It Worth It?`;
    return `The Truth About ${strategy.topic} (Shocking Results)`;
  }

  async generateHook(strategy) {
    const aiHook = await this.callGemini(
      `Write a 1-2 sentence viral YouTube video hook for a video about "${strategy.topic}".
       It must grab attention in the first 5 seconds and make viewers unable to stop watching.
       Return ONLY the hook text, no quotes, no explanation.`
    );

    return {
      type: 'ai',
      text: aiHook || `Most people have no idea what's really going on with ${strategy.topic} — until now.`,
      duration: '0:00-0:05'
    };
  }

  generateQuestionAbout(topic) {
    const questions = [
      `why ${topic} is becoming so important`,
      `how ${topic} actually works`,
      `what makes ${topic} different from everything else`,
      `why experts are talking about ${topic}`,
      `how ${topic} could change your life`
    ];
    
    return questions[Math.floor(Math.random() * questions.length)];
  }

  generateStatistic(topic) {
    const stats = [
      `90% of people don't understand ${topic} correctly`,
      `${topic} has grown by 300% in the last year alone`,
      `experts predict ${topic} will be worth billions by 2030`,
      `only 1 in 10 people are using ${topic} effectively`,
      `${topic} can save you hours every single day`
    ];
    
    return stats[Math.floor(Math.random() * stats.length)];
  }

  async generateIntroduction(strategy) {
    const aiIntro = await this.callGemini(
      `Write a 3-4 sentence YouTube video introduction for a video about "${strategy.topic}".
       Channel style: viral, entertaining, all ages. Be energetic and engaging.
       Return ONLY the introduction text, no labels or explanation.`
    );
    const introText = aiIntro || `Hey everyone, welcome back! Today we're diving into ${strategy.topic} and you're NOT going to believe what we found.`;
    return {
      greeting: introText,
      topicIntro: `Today's topic: ${strategy.topic}.`,
      valueProposition: `By the end, you'll know exactly why everyone is talking about this.`,
      credibility: 'Based on the latest trending data.',
      duration: '0:05-0:20'
    };
  }

  getValueProposition(strategy) {
    const propositions = {
      'Tutorial': `how to implement ${strategy.topic} step by step`,
      'Explainer': `what ${strategy.topic} is and why it matters`,
      'List': `the most important things about ${strategy.topic}`,
      'Review': `whether ${strategy.topic} is right for you`,
      'Story': `the incredible journey of ${strategy.topic}`
    };
    
    return propositions[strategy.contentType] || `everything about ${strategy.topic}`;
  }

  getCredibilityStatement(strategy) {
    const statements = [
      "I've spent months researching this topic",
      "After working with hundreds of people on this",
      "Based on the latest research and data",
      "Drawing from real-world experience",
      "Using proven methods and strategies"
    ];
    
    return statements[Math.floor(Math.random() * statements.length)];
  }

  async generateMainContent(strategy, template) {
    const aiBody = await this.callGemini(
      `Write the full main body script for a YouTube video about "${strategy.topic}".
       Content type: ${strategy.contentType}. Channel: a viral, trending, entertaining channel for all ages.
       Structure it with 3-5 clear sections. Each section should have a bold heading and 2-4 engaging sentences.
       Keep total length suitable for a 5-8 minute video. Write in a conversational, energetic tone.
       Return ONLY the script body text with section headings, no extra explanation.`
    );

    if (aiBody) {
      return {
        sections: [{ type: 'ai_generated', content: aiBody }],
        totalDuration: '1:00-7:00'
      };
    }

    const sections = [];
    for (const section of template.structure) {
      if (!['hook', 'introduction', 'cta'].includes(section)) {
        sections.push(await this.generateSection(section, strategy));
      }
    }
    return { sections, totalDuration: this.calculateSectionsDuration(sections) };
  }

  async generateSection(sectionType, strategy) {
    const sectionGenerators = {
      problem: () => this.generateProblemSection(strategy),
      solution_steps: () => this.generateSolutionSteps(strategy),
      demonstration: () => this.generateDemonstration(strategy),
      explanation: () => this.generateExplanation(strategy),
      examples: () => this.generateExamples(strategy),
      list_items: () => this.generateListItems(strategy),
      pros: () => this.generatePros(strategy),
      cons: () => this.generateCons(strategy),
      comparison: () => this.generateComparison(strategy),
      implications: () => this.generateImplications(strategy)
    };

    const generator = sectionGenerators[sectionType];
    
    if (generator) {
      return await generator();
    }
    
    return this.generateGenericSection(sectionType, strategy);
  }

  async generateProblemSection(strategy) {
    return {
      type: 'problem',
      title: 'The Challenge',
      content: [
        `Many people struggle with ${strategy.topic}.`,
        `The main issues are:`,
        `1. Lack of clear information`,
        `2. Complexity and confusion`,
        `3. Not knowing where to start`,
        `But don't worry, we're going to solve all of these today.`
      ],
      visuals: ['Problem illustration', 'Statistics graphic'],
      duration: 30
    };
  }

  async generateSolutionSteps(strategy) {
    const steps = [];
    const numSteps = 3 + Math.floor(Math.random() * 3); // 3-5 steps
    
    for (let i = 1; i <= numSteps; i++) {
      steps.push({
        number: i,
        title: `Step ${i}: ${this.generateStepTitle(strategy.topic, i)}`,
        description: this.generateStepDescription(strategy.topic, i),
        tip: this.generateProTip(strategy.topic)
      });
    }
    
    return {
      type: 'solution_steps',
      title: 'The Solution',
      steps,
      duration: steps.length * 45
    };
  }

  generateStepTitle(topic, stepNumber) {
    const titles = [
      'Research and Preparation',
      'Setting Up the Foundation',
      'Implementation and Execution',
      'Testing and Optimization',
      'Scaling and Automation'
    ];
    
    return titles[stepNumber - 1] || `Advanced ${topic} Techniques`;
  }

  generateStepDescription(topic, stepNumber) {
    return `This step involves understanding the key aspects of ${topic} and how to apply them effectively. Pay special attention to the details here, as they make all the difference.`;
  }

  generateProTip(topic) {
    const tips = [
      `Pro tip: Start small and scale gradually`,
      `Remember: Consistency is more important than perfection`,
      `Quick tip: Document everything as you go`,
      `Expert advice: Focus on one aspect at a time`,
      `Insider secret: This works best when combined with regular practice`
    ];
    
    return tips[Math.floor(Math.random() * tips.length)];
  }

  async generateDemonstration(strategy) {
    return {
      type: 'demonstration',
      title: 'Live Demo',
      content: [
        `Now let me show you exactly how this works.`,
        `[Screen recording or visual demonstration]`,
        `As you can see, the process is straightforward once you understand the basics.`,
        `The key is to follow the steps exactly as shown.`
      ],
      visuals: ['Screen recording', 'Step-by-step graphics'],
      duration: 120
    };
  }

  async generateExplanation(strategy) {
    return {
      type: 'explanation',
      title: 'Deep Dive',
      content: [
        `Let's break down ${strategy.topic} into its core components.`,
        `First, we need to understand the fundamental principles.`,
        `The science behind this is fascinating...`,
        `[Detailed explanation with visuals]`,
        `This is why ${strategy.topic} works so effectively.`
      ],
      visuals: ['Diagrams', 'Infographics', 'Charts'],
      duration: 90
    };
  }

  async generateExamples(strategy) {
    return {
      type: 'examples',
      title: 'Real-World Examples',
      content: [
        `Let's look at some real examples of ${strategy.topic} in action.`,
        `Example 1: [Specific case study]`,
        `Example 2: [Another relevant example]`,
        `Example 3: [Third compelling example]`,
        `These examples show the versatility and power of ${strategy.topic}.`
      ],
      visuals: ['Case study graphics', 'Before/after comparisons'],
      duration: 75
    };
  }

  async generateListItems(strategy) {
    const items = [];
    const numItems = 5 + Math.floor(Math.random() * 6); // 5-10 items
    
    for (let i = 1; i <= numItems; i++) {
      items.push({
        number: numItems - i + 1, // Countdown for engagement
        title: this.generateListItemTitle(strategy.topic, i),
        description: this.generateListItemDescription(strategy.topic),
        impact: this.generateImpactStatement()
      });
    }
    
    return {
      type: 'list_items',
      title: `Top ${numItems} Things About ${strategy.topic}`,
      items,
      duration: items.length * 30
    };
  }

  generateListItemTitle(topic, index) {
    const titles = [
      `The Hidden Power of ${topic}`,
      `Why ${topic} Matters More Than You Think`,
      `The Surprising Truth About ${topic}`,
      `How ${topic} Can Transform Your Approach`,
      `The ${topic} Secret Nobody Talks About`,
      `Mastering ${topic} in Record Time`,
      `The Ultimate ${topic} Hack`,
      `${topic}: The Game Changer`,
      `Breaking Down ${topic} Myths`,
      `The Future of ${topic}`
    ];
    
    return titles[index - 1] || `Advanced ${topic} Technique #${index}`;
  }

  generateListItemDescription(topic) {
    return `This aspect of ${topic} is crucial because it fundamentally changes how we approach the subject. Understanding this will give you a significant advantage.`;
  }

  generateImpactStatement() {
    const impacts = [
      'This alone can save you hours',
      'Game-changing for beginners',
      'Essential for long-term success',
      'Often overlooked but critical',
      'The difference between success and failure'
    ];
    
    return impacts[Math.floor(Math.random() * impacts.length)];
  }

  async generatePros(strategy) {
    return {
      type: 'pros',
      title: 'The Benefits',
      points: [
        'Easy to get started',
        'Cost-effective solution',
        'Proven results',
        'Scalable approach',
        'Community support'
      ],
      duration: 45
    };
  }

  async generateCons(strategy) {
    return {
      type: 'cons',
      title: 'Things to Consider',
      points: [
        'Learning curve at the beginning',
        'Requires consistent effort',
        'Results may vary',
        'Some technical knowledge helpful'
      ],
      duration: 30
    };
  }

  async generateComparison(strategy) {
    return {
      type: 'comparison',
      title: 'How It Compares',
      content: `Compared to alternatives, ${strategy.topic} stands out because of its unique approach and proven effectiveness.`,
      comparisonPoints: [
        'More efficient than traditional methods',
        'Better ROI than competitors',
        'Easier to implement',
        'More sustainable long-term'
      ],
      duration: 60
    };
  }

  async generateImplications(strategy) {
    return {
      type: 'implications',
      title: 'What This Means',
      content: [
        `The implications of ${strategy.topic} are far-reaching.`,
        'This will change how we think about the industry.',
        'Early adopters will have a significant advantage.',
        'The potential for growth is enormous.'
      ],
      duration: 45
    };
  }

  generateGenericSection(sectionType, strategy) {
    return {
      type: sectionType,
      title: sectionType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      content: `This section covers important aspects of ${strategy.topic} that you need to know.`,
      duration: 60
    };
  }

  async generateConclusion(strategy) {
    const aiConclusion = await this.callGemini(
      `Write a 2-3 sentence conclusion for a YouTube video about "${strategy.topic}".
       End on a high note that leaves viewers wanting more. Return ONLY the conclusion text.`
    );
    return {
      type: 'conclusion',
      title: 'Wrapping Up',
      finalThought: aiConclusion || `That's a wrap on ${strategy.topic} — absolutely wild, right? Drop your reaction in the comments!`,
      duration: '30 seconds'
    };
  }

  async generateCTA(strategy) {
    return {
      type: 'call_to_action',
      subscribe: "If this blew your mind, smash that subscribe button and ring the bell so you never miss a new video!",
      like: "Tap the like button if this video shocked you.",
      comment: `Comment below: Did you already know about ${strategy.topic}? Let's see who's in the know!`,
      nextVideo: "Check out our next video — you won't believe what we found.",
      duration: '15 seconds'
    };
  }

  formatFullScript(script) {
    let fullScript = '';
    
    // Title
    fullScript += `TITLE: ${script.title}\n\n`;
    fullScript += '═'.repeat(50) + '\n\n';
    
    // Hook
    fullScript += `[${script.hook.duration}] HOOK\n`;
    fullScript += `${script.hook.text}\n\n`;
    
    // Introduction
    fullScript += `[${script.introduction.duration}] INTRODUCTION\n`;
    fullScript += `${script.introduction.greeting}\n`;
    fullScript += `${script.introduction.topicIntro}\n`;
    fullScript += `${script.introduction.valueProposition}\n`;
    fullScript += `${script.introduction.credibility}\n\n`;
    
    // Main Content
    fullScript += 'MAIN CONTENT\n';
    fullScript += '─'.repeat(30) + '\n\n';
    
    for (const section of script.mainContent.sections) {
      if (section.title) fullScript += `[${this.formatDuration(section.duration)}] ${section.title.toUpperCase()}\n`;

      if (Array.isArray(section.content)) {
        section.content.forEach(line => { fullScript += `${line}\n`; });
      } else if (typeof section.content === 'string') {
        fullScript += `${section.content}\n`;
      } else if (section.steps) {
        section.steps.forEach(step => {
          fullScript += `\n${step.title}\n${step.description}\n💡 ${step.tip}\n`;
        });
      } else if (section.items) {
        section.items.forEach(item => {
          fullScript += `\n#${item.number}: ${item.title}\n${item.description}\nImpact: ${item.impact}\n`;
        });
      } else if (section.points) {
        section.points.forEach(point => { fullScript += `• ${point}\n`; });
      }

      if (section.visuals) fullScript += `\n[VISUALS: ${section.visuals.join(', ')}]\n`;
      fullScript += '\n';
    }

    // Conclusion
    fullScript += `[${script.conclusion.duration || '30s'}] CONCLUSION\n`;
    if (Array.isArray(script.conclusion.recap)) {
      script.conclusion.recap.forEach(line => { fullScript += `${line}\n`; });
    }
    fullScript += `\n${script.conclusion.finalThought || ''}\n\n`;
    
    // Call to Action
    fullScript += `[${script.callToAction.duration}] CALL TO ACTION\n`;
    fullScript += `${script.callToAction.subscribe}\n`;
    fullScript += `${script.callToAction.like}\n`;
    fullScript += `${script.callToAction.comment}\n`;
    fullScript += `${script.callToAction.nextVideo}\n\n`;
    
    // Metadata
    fullScript += '═'.repeat(50) + '\n';
    fullScript += `ESTIMATED DURATION: ${script.duration}\n`;
    fullScript += `TONE: ${script.tone}\n`;
    fullScript += `PACING: ${script.pacing}\n`;
    fullScript += `KEYWORDS: ${(script.keywords || []).join(', ')}\n`;
    
    return fullScript;
  }

  estimateDuration(mainContent) {
    const totalSeconds = mainContent.sections.reduce((total, section) => {
      return total + (section.duration || 60);
    }, 0);
    
    // Add hook, intro, conclusion, CTA
    const fullDuration = totalSeconds + 5 + 15 + 30 + 15;
    
    return this.formatDuration(fullDuration);
  }

  formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  calculateSectionsDuration(sections) {
    return sections.reduce((total, section) => total + (section.duration || 60), 0);
  }
}

module.exports = { ScriptWriterAgent };