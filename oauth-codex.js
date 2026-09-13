import {
    CODEX_CLIENT_ID,
    CODEX_USERCODE_URL,
    CODEX_DEVICE_TOKEN_URL,
    CODEX_TOKEN_URL,
    CODEX_DEVICE_REDIRECT_URI,
    CODEX_VERIFICATION_URL,
    parseCodexUserCode,
    parseCodexGrant,
    isCodexPollPending,
    sessionFromOAuthTokenResponse,
    keepPriorRefresh,
} from './oauth-lib.js';

const DEVICE_TTL_MS = 15 * 60 * 1000;

async function parseJson(response) {
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(text || `HTTP ${response.status}`);
    }
}

async function readError(response) {
    const text = await response.text().catch(() => '');
    try {
        const json = JSON.parse(text);
        return [json.error, json.error_description].filter(Boolean).join(': ') || `HTTP ${response.status}`;
    } catch {
        return text || `HTTP ${response.status}`;
    }
}

export async function runCodexDeviceLogin({
    fetch,
    openUrl,
    onDevice,
    sleep = (ms) => new Promise(r => setTimeout(r, ms)),
    now = Date.now,
    signal,
} = {}) {
    const doFetch = fetch || globalThis.fetch;
    const codeRes = await doFetch(CODEX_USERCODE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
        signal,
    });
    if (!codeRes.ok) throw new Error(`ChatGPT device authorization request failed: HTTP ${codeRes.status}`);
    const device = parseCodexUserCode(await parseJson(codeRes));
    onDevice?.({
        userCode: device.userCode,
        verificationUrl: CODEX_VERIFICATION_URL,
        intervalMs: device.intervalMs,
        expiresIn: DEVICE_TTL_MS / 1000,
    });
    if (openUrl) openUrl(CODEX_VERIFICATION_URL);

    const deadline = now() + DEVICE_TTL_MS;
    let grant;
    while (now() < deadline) {
        if (signal?.aborted) throw new Error('Login cancelled');
        const pollRes = await doFetch(CODEX_DEVICE_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_auth_id: device.deviceAuthId, user_code: device.userCode }),
            signal,
        });
        if (isCodexPollPending(pollRes.status)) {
            const remaining = deadline - now();
            if (remaining <= 0) break;
            await sleep(Math.min(device.intervalMs, remaining), signal);
            continue;
        }
        if (!pollRes.ok) throw new Error(`ChatGPT device authorization poll failed: HTTP ${pollRes.status}`);
        grant = parseCodexGrant(await parseJson(pollRes));
        break;
    }
    if (!grant) throw new Error('ChatGPT device authorization expired');

    const tokenRes = await doFetch(CODEX_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: CODEX_CLIENT_ID,
            code: grant.authorizationCode,
            code_verifier: grant.codeVerifier,
            redirect_uri: CODEX_DEVICE_REDIRECT_URI,
        }).toString(),
        signal,
    });
    if (!tokenRes.ok) throw new Error(`ChatGPT token exchange failed: HTTP ${tokenRes.status}`);
    return sessionFromOAuthTokenResponse(await parseJson(tokenRes), now());
}

export async function refreshCodexSession({ fetch, session, now = Date.now, signal } = {}) {
    if (!session?.refreshToken) throw new Error('No Codex refresh token');
    const doFetch = fetch || globalThis.fetch;
    const res = await doFetch(CODEX_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: CODEX_CLIENT_ID,
            refresh_token: session.refreshToken,
        }).toString(),
        signal,
    });
    if (!res.ok) throw new Error(`ChatGPT refresh failed: ${res.status} ${await readError(res)}`);
    const next = sessionFromOAuthTokenResponse(await parseJson(res), now());
    if (!next.accountId && session.accountId) next.accountId = session.accountId;
    if (!next.email && session.email) next.email = session.email;
    return keepPriorRefresh(next, session.refreshToken);
}
