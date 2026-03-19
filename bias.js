// bias.js - Multi-LLM bias/fact-check analysis module

// ── JSON output schema ────────────────────────────────────────────────────
const CLAIM_SCHEMA = `{
  "summary": "2-3 sentences on what the article claims and its overall thrust",
  "credibility": "High|Medium|Low",
  "credibilityReason": "one sentence explaining the credibility rating",
  "claims": [
    {
      "claim": "4-8 word specific checkable assertion",
      "verdict": "likely true|likely false|mixed/disputed|unverified",
      "supporting": ["specific evidence from the article or established corroborating fact"],
      "opposing": ["counter-evidence, methodological caveat, or alternative reading"],
      "assessment": "1-2 sentences tying the verdict to specific evidence or phrasing in the article",
      "deepDive": "3-4 sentences of deeper context, methodology notes, and what full verification would require"
    }
  ]
}`;

// ── Prompt builder ────────────────────────────────────────────────────────
function getPrompt(analysisType, date) {
    const d = date || new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const footer = `\nOutput ONLY the JSON object. No markdown fences. No explanation before or after.`;

    switch (analysisType) {
        case 'political':
            return `You are a neutral political analyst. Today is ${d}.

Evaluate the article's FRAMING, language, and sourcing — not your training cutoff. Treat the article's publication date as the present.

Analyze the article and output ONLY valid JSON matching this exact schema:
${CLAIM_SCHEMA}
${footer}

Rules:
- 3-6 claims about framing choices, not the events themselves
- "claim": 4-8 words describing a specific framing assertion (e.g., "Sources exclusively favor one political side")
- "verdict": likely true | likely false | mixed/disputed | unverified — judged against neutral journalism standards
- "supporting": specific examples of this framing from the text, quoted where possible
- "opposing": evidence of balance or alternative readings of the same text
- "credibility": High (broadly balanced) | Medium (some lean) | Low (strong partisan lean)`;

        case 'summary':
            return `You are a neutral summarizer. Today is ${d}.

Evaluate what the article asserts and how it asserts it — not your training cutoff. Treat the article's publication date as the present.

Analyze the article and output ONLY valid JSON matching this exact schema:
${CLAIM_SCHEMA}
${footer}

Rules:
- 3-6 claims representing the article's key factual assertions
- "claim": 4-8 words identifying a specific assertion made in the article
- "verdict": likely true | likely false | mixed/disputed | unverified — based on sourcing quality within the article
- "supporting": facts or sources cited in the article that back the claim
- "opposing": what's missing, contested, or editorially framed around this claim
- "assessment": distinguish reported fact from editorial opinion or framing
- "credibility": High (multi-source, factual) | Medium (partial sourcing) | Low (primarily opinion or unsourced)`;

        default: // factcheck
            return `You are a neutral fact-checker. Today is ${d}.

Evaluate claims based on source credibility, corroboration, and journalistic standards — not your training cutoff. Treat the article's publication date as the present.

Analyze the article and output ONLY valid JSON matching this exact schema:
${CLAIM_SCHEMA}
${footer}

Rules:
- 3-6 claims. Each is a distinct, verifiable assertion made in the article.
- "claim": 4-8 words, specific and checkable (e.g., "Suicidal ideation up 154% since 2007")
- "verdict":
    "likely true"    — multiple independent sources cited or well-established fact
    "likely false"   — contradicted by sourcing or a clear factual error
    "mixed/disputed" — partially supported or genuinely contested among sources
    "unverified"     — single source, anonymous, or no evidence provided
- "supporting": 2-3 bullets of evidence from the article or known corroboration
- "opposing": 1-3 bullets of counter-evidence, caveats, or methodological concerns
- "assessment": cite specific phrases from the article as evidence
- "credibility": High (multiple independent sources) | Medium (some sourcing gaps) | Low (single source, propaganda, or anonymous-only)`;
    }
}

// ── Query functions ───────────────────────────────────────────────────────

async function queryOpenAI(apiKey, prompt, text) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: 'gpt-4o',
            messages: [{ role: 'system', content: prompt }, { role: 'user', content: text }],
            max_tokens: 2000,
            response_format: { type: 'json_object' }
        })
    });
    if (!response.ok) { const e = await response.json().catch(() => ({})); throw new Error(e.error?.message || `HTTP ${response.status}`); }
    return (await response.json()).choices[0].message.content;
}

async function queryAnthropic(apiKey, prompt, text) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
            model: 'claude-opus-4-6',
            max_tokens: 2000,
            system: prompt,
            messages: [
                { role: 'user', content: text },
                { role: 'assistant', content: '{' }   // prefill forces JSON output
            ]
        })
    });
    if (!response.ok) { const e = await response.json().catch(() => ({})); throw new Error(e.error?.message || `HTTP ${response.status}`); }
    const data = await response.json();
    return '{' + data.content[0].text;   // restore the prefilled '{'
}

async function queryGemini(apiKey, prompt, text) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            system_instruction: { parts: [{ text: prompt }] },
            contents: [{ role: 'user', parts: [{ text: text }] }],
            generationConfig: { maxOutputTokens: 2000, responseMimeType: 'application/json' }
        })
    });
    if (!response.ok) { const e = await response.json().catch(() => ({})); throw new Error(e.error?.message || `HTTP ${response.status}`); }
    return (await response.json()).candidates[0].content.parts[0].text;
}

async function queryGrok(apiKey, prompt, text) {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: 'grok-2-latest',
            messages: [{ role: 'system', content: prompt }, { role: 'user', content: text }],
            max_tokens: 2000,
            response_format: { type: 'json_object' }
        })
    });
    if (!response.ok) { const e = await response.json().catch(() => ({})); throw new Error(e.error?.message || `HTTP ${response.status}`); }
    return (await response.json()).choices[0].message.content;
}

async function queryOllama(baseUrl, model, prompt, text) {
    const base = (baseUrl || 'http://localhost:11434').replace(/\/$/, '');
    if (!model) {
        const tagsRes = await fetch(`${base}/api/tags`).catch(() => null);
        if (!tagsRes || !tagsRes.ok) throw new Error('Ollama not reachable. Is it running?');
        const tags = await tagsRes.json();
        const models = tags.models || [];
        if (!models.length) throw new Error('No models found in Ollama. Run: ollama pull <model>');
        model = models[0].name;
        console.log('[FoxVox] Ollama auto-selected model:', model);
    }
    const response = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model,
            messages: [{ role: 'system', content: prompt }, { role: 'user', content: text }],
            stream: true,   // streaming keeps the connection alive for slow/large models
            format: 'json'
        })
    });
    if (!response.ok) { const e = await response.json().catch(() => ({})); throw new Error(e.error || `HTTP ${response.status} — is Ollama running?`); }

    // Collect newline-delimited JSON stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let content = '';
    let buffer = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep any incomplete trailing line
        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const chunk = JSON.parse(line);
                if (chunk.message?.content) content += chunk.message.content;
            } catch (e) { /* skip malformed lines */ }
        }
    }
    return content;
}

async function queryLMStudio(baseUrl, model, prompt, text) {
    const url = (baseUrl || 'http://localhost:1234').replace(/\/$/, '') + '/v1/chat/completions';
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: model || 'local-model',
            messages: [{ role: 'system', content: prompt }, { role: 'user', content: text }],
            stream: true   // streaming keeps the connection alive for slow/large models
            // response_format omitted — most local models return 400 if they don't support it
        })
    });
    if (!response.ok) { const e = await response.json().catch(() => ({})); throw new Error(e.error?.message || `HTTP ${response.status} — is LM Studio running?`); }

    // Collect OpenAI-compatible SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let content = '';
    let buffer = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep any incomplete trailing line
        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
                const chunk = JSON.parse(data);
                const delta = chunk.choices?.[0]?.delta?.content;
                if (delta) content += delta;
            } catch (e) { /* skip malformed SSE lines */ }
        }
    }
    return content;
}

// ── Providers registry ────────────────────────────────────────────────────
export const PROVIDERS = {
    openai:    { name: 'OpenAI GPT-4o',     query: queryOpenAI,    color: '#10a37f', local: false, defaultUrl: null },
    anthropic: { name: 'Anthropic Claude',   query: queryAnthropic, color: '#d97706', local: false, defaultUrl: null },
    gemini:    { name: 'Google Gemini 1.5',  query: queryGemini,    color: '#4285f4', local: false, defaultUrl: null },
    grok:      { name: 'xAI Grok 2',         query: queryGrok,      color: '#1a1a2e', local: false, defaultUrl: null },
    ollama:    { name: 'Ollama (Local)',      query: null,           color: '#333333', local: true,  defaultUrl: 'http://localhost:11434' },
    lmstudio:  { name: 'LM Studio (Local)',  query: null,           color: '#6b21a8', local: true,  defaultUrl: 'http://localhost:1234' }
};

// ── Main export ───────────────────────────────────────────────────────────
// newsContext: optional string injected into the system prompt
export async function runBiasAnalysis(selectedProviders, apiKeys, analysisType, text, newsContext) {
    const date = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const basePrompt = getPrompt(analysisType, date);
    const prompt = newsContext ? `${basePrompt}\n\n${newsContext}` : basePrompt;

    const cloudLimit = 12000;
    const localLimit = 20000;

    const results = await Promise.allSettled(
        selectedProviders.map(async (providerId) => {
            const provider = PROVIDERS[providerId];
            const articleText = text.slice(0, provider.local ? localLimit : cloudLimit);
            let analysis;

            if (providerId === 'ollama') {
                analysis = await queryOllama(apiKeys.ollama_url || provider.defaultUrl, apiKeys.ollama_model || null, prompt, articleText);
            } else if (providerId === 'lmstudio') {
                analysis = await queryLMStudio(apiKeys.lmstudio_url || provider.defaultUrl, apiKeys.lmstudio_model || 'local-model', prompt, articleText);
            } else {
                const key = apiKeys[providerId];
                if (!key) throw new Error('No API key configured. Add one in Settings.');
                analysis = await provider.query(key, prompt, articleText);
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
