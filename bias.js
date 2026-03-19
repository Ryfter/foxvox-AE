// bias.js - Multi-LLM bias/fact-check analysis module
// Queries multiple AI providers in parallel and returns their analyses

const ANALYSIS_PROMPTS = {
    factcheck: `You are a neutral fact-checker. Be thorough in your analysis and concise in your writing — every sentence must earn its place.

1. SUMMARY: 2–3 sentences on what the article claims and its overall thrust.
2. KEY CLAIMS: For each significant claim write one line and mark it:
   ✓ Well-supported | ✗ Disputed or false | ? Unclear / missing context
3. MISSING CONTEXT: Specific facts, studies, or events whose absence materially distorts the reader's understanding.
4. BIAS SIGNALS: Concrete examples of loaded language, selective framing, or misleading omissions — quote the text.
5. VERDICT: Objective / Leans Left / Leans Right / Misleading / Mixed — one sentence of justification.

No filler. No repetition. Cite specific phrases from the article as evidence.`,

    political: `You are a neutral political analyst. Be thorough in your analysis and concise in your writing — every sentence must earn its place.

1. POLITICAL LEAN: The perspective this piece favors — name it and cite specific evidence from the text.
2. FRAMING: Concrete examples of loaded language, selective emphasis, or how groups and events are characterized.
3. VOICES INCLUDED: Whose perspectives are actively represented and how much space they receive.
4. VOICES EXCLUDED: Significant viewpoints absent — and why their absence matters to the overall picture.
5. CROSS-AISLE READ: How a reader from the opposing political perspective would interpret this piece differently.
6. RATING: Far-Left / Left / Center-Left / Center / Center-Right / Right / Far-Right — one sentence of justification.

No filler. Be specific. Quote the article directly when identifying bias.`,

    summary: `You are a neutral summarizer. Be thorough in your analysis and concise in your writing — every sentence must earn its place.

1. CORE FACTS: Verifiable, source-checkable facts only — no spin, no characterization.
2. OPINION vs. FACT: Explicitly flag which statements are editorial framing or interpretation rather than reported fact.
3. ALL PERSPECTIVES: Every viewpoint present in the article, stated fairly and without asymmetric treatment.
4. WHAT'S MISSING: Specific information a fully balanced account would include.
5. ONE-LINE SUMMARY: A single objective sentence that any reader — regardless of politics — would accept as accurate.

No filler. Separate facts from framing rigorously. Quote the article when drawing distinctions.`
};

async function queryOpenAI(apiKey, prompt, text) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: prompt },
                { role: 'user', content: text.slice(0, 8000) }
            ],
            max_tokens: 2000
        })
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${response.status}`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
}

async function queryAnthropic(apiKey, prompt, text) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model: 'claude-opus-4-6',
            max_tokens: 2000,
            system: prompt,
            messages: [{ role: 'user', content: text.slice(0, 8000) }]
        })
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${response.status}`);
    }
    const data = await response.json();
    return data.content[0].text;
}

async function queryGemini(apiKey, prompt, text) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            system_instruction: { parts: [{ text: prompt }] },
            contents: [{ role: 'user', parts: [{ text: text.slice(0, 8000) }] }],
            generationConfig: { maxOutputTokens: 2000 }
        })
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${response.status}`);
    }
    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
}

async function queryGrok(apiKey, prompt, text) {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'grok-2-latest',
            messages: [
                { role: 'system', content: prompt },
                { role: 'user', content: text.slice(0, 8000) }
            ],
            max_tokens: 2000
        })
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${response.status}`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
}

// Ollama native API — uses /api/chat which has no CORS restriction on the /v1/ routes
async function queryOllama(baseUrl, model, prompt, text) {
    const base = baseUrl.replace(/\/$/, '');

    // Auto-detect first available model if none configured
    if (!model) {
        const tagsRes = await fetch(`${base}/api/tags`).catch(() => null);
        if (!tagsRes || !tagsRes.ok) throw new Error('Ollama not reachable. Is it running?');
        const tagsData = await tagsRes.json();
        const models = tagsData.models || [];
        if (models.length === 0) throw new Error('No models found in Ollama. Run: ollama pull <model>');
        model = models[0].name;
        console.log('[FoxVox] Ollama auto-selected model:', model);
    }

    const url = base + '/api/chat';
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: model,
            messages: [
                { role: 'system', content: prompt },
                { role: 'user', content: text.slice(0, 8000) }
            ],
            stream: false
        })
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${response.status} — is Ollama running?`);
    }
    const data = await response.json();
    return data.message.content;
}

// LM Studio uses the OpenAI-compatible /v1/chat/completions endpoint
async function queryLMStudio(baseUrl, model, prompt, text) {
    const url = baseUrl.replace(/\/$/, '') + '/v1/chat/completions';
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: model,
            messages: [
                { role: 'system', content: prompt },
                { role: 'user', content: text.slice(0, 8000) }
            ],
            stream: false
        })
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${response.status} — is LM Studio running?`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
}

export const PROVIDERS = {
    openai:    { name: 'OpenAI GPT-4o',        query: queryOpenAI,    color: '#10a37f', local: false },
    anthropic: { name: 'Anthropic Claude',      query: queryAnthropic, color: '#d97706', local: false },
    gemini:    { name: 'Google Gemini 1.5',     query: queryGemini,    color: '#4285f4', local: false },
    grok:      { name: 'xAI Grok 2',            query: queryGrok,      color: '#1a1a2e', local: false },
    ollama:    { name: 'Ollama (Local)',         query: null,           color: '#333333', local: true,  defaultUrl: 'http://localhost:11434' },
    lmstudio:  { name: 'LM Studio (Local)',      query: null,           color: '#6b21a8', local: true,  defaultUrl: 'http://localhost:1234'  }
};

// apiKeys shape:
//   { openai, anthropic, gemini, grok }            — cloud provider keys
//   { ollama_url, ollama_model }                   — Ollama config
//   { lmstudio_url, lmstudio_model }               — LM Studio config
export async function runBiasAnalysis(selectedProviders, apiKeys, analysisType, text) {
    const prompt = ANALYSIS_PROMPTS[analysisType] || ANALYSIS_PROMPTS.factcheck;

    const results = await Promise.allSettled(
        selectedProviders.map(async (providerId) => {
            const provider = PROVIDERS[providerId];
            let analysis;

            if (providerId === 'ollama') {
                const url   = apiKeys.ollama_url   || provider.defaultUrl;
                const model = apiKeys.ollama_model || null; // auto-detect if not set
                analysis = await queryOllama(url, model, prompt, text);

            } else if (providerId === 'lmstudio') {
                const url   = apiKeys.lmstudio_url   || provider.defaultUrl;
                const model = apiKeys.lmstudio_model || 'local-model';
                analysis = await queryLMStudio(url, model, prompt, text);

            } else {
                const key = apiKeys[providerId];
                if (!key) throw new Error('No API key configured. Add one in Settings.');
                analysis = await provider.query(key, prompt, text);
            }

            return { providerId, name: provider.name, color: provider.color, analysis };
        })
    );

    return results.map((result, i) => {
        const providerId = selectedProviders[i];
        if (result.status === 'fulfilled') return result.value;
        return {
            providerId,
            name: PROVIDERS[providerId]?.name || providerId,
            color: '#888888',
            analysis: null,
            error: result.reason?.message || 'Unknown error'
        };
    });
}
