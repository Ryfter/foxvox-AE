export const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';
export const CODEX_DEFAULT_MODEL = 'gpt-5.4';

export function buildCodexHeaders(session) {
    const headers = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${session.accessToken}`,
        originator: 'foxvox-extended',
        'OpenAI-Beta': 'responses=experimental',
        session_id: (globalThis.crypto?.randomUUID?.() || `sess-${Date.now()}`),
    };
    if (session.accountId) headers['ChatGPT-Account-Id'] = session.accountId;
    return headers;
}

export function buildCodexRequestBody({ model, instructions, userText }) {
    return {
        model: model || CODEX_DEFAULT_MODEL,
        store: false,
        stream: true,
        instructions,
        input: [{ role: 'user', content: userText }],
    };
}

export function collectResponsesSseText(sseText) {
    let out = '';
    for (const line of String(sseText).split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data || data === '[DONE]') continue;
        let payload;
        try {
            payload = JSON.parse(data);
        } catch {
            continue;
        }
        const type = payload.type;
        if (type === 'response.output_text.delta' && typeof payload.delta === 'string') {
            out += payload.delta;
            continue;
        }
        if (typeof payload.delta === 'string' && !type) {
            out += payload.delta;
            continue;
        }
        const completed = payload.response?.output_text;
        if (typeof completed === 'string' && completed && !out) out = completed;
    }
    return out;
}

async function readSse(response) {
    if (!response.body || !response.body.getReader) {
        return collectResponsesSseText(await response.text());
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop();
        for (const part of parts) text += collectResponsesSseText(part + '\n');
    }
    if (buffer) text += collectResponsesSseText(buffer);
    return text;
}

export async function queryCodex(session, instructions, userText, { fetch, model } = {}) {
    const doFetch = fetch || globalThis.fetch;
    const response = await doFetch(CODEX_RESPONSES_URL, {
        method: 'POST',
        headers: buildCodexHeaders(session),
        body: JSON.stringify(buildCodexRequestBody({
            model,
            instructions,
            userText,
        })),
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        const msg = err.detail || err.error?.message || `HTTP ${response.status}`;
        throw new Error(`Codex: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    }
    return readSse(response);
}
