const axios = require('axios');
const { Logger } = require('./logger');

// NVIDIA NIM is OpenAI-compatible. We use Llama 4 Maverick — the strongest
// open-weight model for creative writing, and free on the NIM dev tier.
// It handles dark/emotional cliffhanger story content far better than Gemini,
// which tends toward positive framing and verbose, procedural prose.
const BASE_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MODEL = 'meta/llama-4-maverick-17b-128e-instruct';

class NIMClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.logger = new Logger('NIM');
  }

  // Generate a completion. Returns the raw text content.
  // temperature 0.9 + top_p 0.95 is the sweet spot for emotional prose —
  // default Q&A settings produce flat, lifeless writing regardless of model.
  async generate(prompt, { temperature = 0.9, maxTokens = 1200 } = {}) {
    const response = await axios.post(
      BASE_URL,
      {
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature,
        top_p: 0.95,
        max_tokens: maxTokens
      },
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 90000
      }
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('No content in NIM response');
    return content.trim();
  }

  // Generate and parse JSON output. Strips markdown fences and retries parse.
  async generateJSON(prompt, opts = {}) {
    const raw = await this.generate(prompt, opts);
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    try {
      return JSON.parse(cleaned);
    } catch (_) {
      // Models sometimes wrap JSON in prose — extract the first {...} block
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
      throw new Error('Could not parse JSON from NIM response');
    }
  }
}

module.exports = { NIMClient };
