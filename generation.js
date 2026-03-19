// generation.js - Multi-provider page rewrite

function extractHTML(text) {
    const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
    if (fenced) return fenced[1].trim();
    return text.trim();
}

const REFINE_PROMPT = 'Review your rewrite carefully. Ensure it fully follows the requirements. Output only the final rewritten HTML — no markdown fences, no explanation, just raw HTML.';

// ── OpenAI function-calling (tool_choice) ─────────────────────────────────
async function openAIToolCompletion(apiKey, baseUrl, model, messages) {
    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            model,
            messages,
            tools: [{
                type: 'function',
                function: {
                    name: 'output',
                    description: 'Output the rewritten HTML',
                    parameters: { type: 'object', properties: { html: { type: 'string' } }, required: ['html'] }
                }
            }],
            tool_choice: 'required'
        })
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${response.status}`);
    }
    const data = await response.json();
    return JSON.parse(data.choices[0].message.tool_calls[0].function.arguments).html;
}

async function rewriteWithToolUse(apiKey, baseUrl, model, template, original) {
    const sys = { role: 'system', content: template.generation };
    const usr = { role: 'user', content: original };
    const first = await openAIToolCompletion(apiKey, baseUrl, model, [sys, usr]);
    return openAIToolCompletion(apiKey, baseUrl, model, [
        sys, usr,
        { role: 'assistant', content: first },
        { role: 'user', content: REFINE_PROMPT }
    ]);
}

// ── OpenAI-compatible plain text (LM Studio, fallback) ───────────────────
async function openAITextCompletion(apiKey, baseUrl, model, messages) {
    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify({ model: model || 'local-model', messages, max_tokens: 4096, stream: false })
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${response.status}`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
}

async function rewriteWithOpenAIText(apiKey, baseUrl, model, template, original) {
    const sys = template.generation + '\n\nOutput only the rewritten HTML — no markdown fences, no explanation, just raw HTML.';
    const first = await openAITextCompletion(apiKey, baseUrl, model, [
        { role: 'system', content: sys },
        { role: 'user', content: original }
    ]);
    const refined = await openAITextCompletion(apiKey, baseUrl, model, [
        { role: 'system', content: sys },
        { role: 'user', content: original },
        { role: 'assistant', content: first },
        { role: 'user', content: REFINE_PROMPT }
    ]);
    return extractHTML(refined);
}

// ── Anthropic ─────────────────────────────────────────────────────────────
async function anthropicCompletion(apiKey, model, system, messages) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 4096, system, messages })
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${response.status}`);
    }
    const data = await response.json();
    return data.content[0].text;
}

async function rewriteAnthropic(apiKey, model, template, original) {
    const system = template.generation + '\n\nOutput only the rewritten HTML — no markdown fences, no explanation, just raw HTML.';
    const first = await anthropicCompletion(apiKey, model, system, [{ role: 'user', content: original }]);
    const refined = await anthropicCompletion(apiKey, model, system, [
        { role: 'user', content: original },
        { role: 'assistant', content: first },
        { role: 'user', content: REFINE_PROMPT }
    ]);
    return extractHTML(refined);
}

// ── Gemini ────────────────────────────────────────────────────────────────
async function geminiCompletion(apiKey, model, systemPrompt, contents) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: { maxOutputTokens: 4096 }
        })
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${response.status}`);
    }
    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
}

async function rewriteGemini(apiKey, model, template, original) {
    const system = template.generation + '\n\nOutput only the rewritten HTML — no markdown fences, no explanation, just raw HTML.';
    const first = await geminiCompletion(apiKey, model, system, [
        { role: 'user', parts: [{ text: original }] }
    ]);
    const refined = await geminiCompletion(apiKey, model, system, [
        { role: 'user', parts: [{ text: original }] },
        { role: 'model', parts: [{ text: first }] },
        { role: 'user', parts: [{ text: REFINE_PROMPT }] }
    ]);
    return extractHTML(refined);
}

// ── Ollama (native /api/chat) ─────────────────────────────────────────────
async function ollamaCompletion(baseUrl, model, messages) {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: false })
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${response.status} — is Ollama running?`);
    }
    const data = await response.json();
    return data.message.content;
}

async function rewriteOllama(baseUrl, model, template, original) {
    const base = (baseUrl || 'http://localhost:11434').replace(/\/$/, '');
    if (!model) {
        const tagsRes = await fetch(`${base}/api/tags`).catch(() => null);
        if (!tagsRes || !tagsRes.ok) throw new Error('Ollama not reachable. Is it running?');
        const tagsData = await tagsRes.json();
        const models = tagsData.models || [];
        if (!models.length) throw new Error('No models found in Ollama. Run: ollama pull <model>');
        model = models[0].name;
        console.log('[FoxVox] Ollama rewrite auto-selected model:', model);
    }
    const system = template.generation + '\n\nOutput only the rewritten HTML — no markdown fences, no explanation, just raw HTML.';
    const first = await ollamaCompletion(base, model, [
        { role: 'system', content: system },
        { role: 'user', content: original }
    ]);
    const refined = await ollamaCompletion(base, model, [
        { role: 'system', content: system },
        { role: 'user', content: original },
        { role: 'assistant', content: first },
        { role: 'user', content: REFINE_PROMPT }
    ]);
    return extractHTML(refined);
}

// ── Main export ───────────────────────────────────────────────────────────
// provider: 'openai' | 'anthropic' | 'gemini' | 'grok' | 'ollama' | 'lmstudio'
// apiKeys:  { openai, anthropic, gemini, grok, ollama_url, ollama_model, lmstudio_url, lmstudio_model }
export async function CoT(provider, apiKeys, template, original) {
    switch (provider) {
        case 'openai':
            if (!apiKeys.openai) throw new Error('No OpenAI key configured. Add one in Settings.');
            return rewriteWithToolUse(apiKeys.openai, 'https://api.openai.com/v1', 'gpt-4o', template, original);

        case 'anthropic':
            if (!apiKeys.anthropic) throw new Error('No Anthropic key configured. Add one in Settings.');
            return rewriteAnthropic(apiKeys.anthropic, 'claude-opus-4-6', template, original);

        case 'gemini':
            if (!apiKeys.gemini) throw new Error('No Gemini key configured. Add one in Settings.');
            return rewriteGemini(apiKeys.gemini, 'gemini-1.5-flash', template, original);

        case 'grok':
            if (!apiKeys.grok) throw new Error('No Grok key configured. Add one in Settings.');
            return rewriteWithToolUse(apiKeys.grok, 'https://api.x.ai/v1', 'grok-2-latest', template, original);

        case 'ollama':
            return rewriteOllama(apiKeys.ollama_url, apiKeys.ollama_model, template, original);

        case 'lmstudio': {
            const base = (apiKeys.lmstudio_url || 'http://localhost:1234').replace(/\/$/, '') + '/v1';
            return rewriteWithOpenAIText(null, base, apiKeys.lmstudio_model || 'local-model', template, original);
        }

        default:
            throw new Error(`Unknown rewrite provider: ${provider}`);
    }
}
