import {
    XAI_CLIENT_ID,
    XAI_SCOPE,
    XAI_DEVICE_CODE_URL,
    XAI_TOKEN_URL,
    XAI_DEVICE_GRANT,
    parseXaiDevice,
    xaiSessionFromTokenResponse,
    keepPriorRefresh,
} from './oauth-lib.js';

const FORM_HEADERS = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
};

async function readError(response) {
    const text = await response.text().catch(() => '');
    try {
        const json = JSON.parse(text);
        return json.error_description || json.error || json.message || text || `HTTP ${response.status}`;
    } catch {
        return text || `HTTP ${response.status}`;
    }
}

async function parseJson(response) {
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(text || `HTTP ${response.status}`);
    }
}

export async function runXaiDeviceLogin({
    fetch,
    openUrl,
    onDevice,
    sleep = (ms) => new Promise(r => setTimeout(r, ms)),
    now = Date.now,
    signal,
} = {}) {
    const doFetch = fetch || globalThis.fetch;
    const codeRes = await doFetch(XAI_DEVICE_CODE_URL, {
        method: 'POST',
        headers: FORM_HEADERS,
        body: new URLSearchParams({
            client_id: XAI_CLIENT_ID,
            scope: XAI_SCOPE,
            referrer: 'foxvox-extended',
        }),
        signal,
    });
    if (!codeRes.ok) throw new Error(`xAI device code request failed (${codeRes.status}): ${await readError(codeRes)}`);
    const device = parseXaiDevice(await parseJson(codeRes));
    onDevice?.(device);
    if (openUrl) openUrl(device.verificationUrl);

    const deadline = now() + device.expiresIn * 1000;
    let intervalMs = device.intervalMs;
    while (now() < deadline) {
        if (signal?.aborted) throw new Error('Login cancelled');
        await sleep(intervalMs, signal);
        const tokenRes = await doFetch(XAI_TOKEN_URL, {
            method: 'POST',
            headers: FORM_HEADERS,
            body: new URLSearchParams({
                grant_type: XAI_DEVICE_GRANT,
                client_id: XAI_CLIENT_ID,
                device_code: device.deviceCode,
            }),
            signal,
        });
        if (tokenRes.ok) {
            return xaiSessionFromTokenResponse(await parseJson(tokenRes), now());
        }
        const errBody = await parseJson(tokenRes).catch(() => ({}));
        const err = errBody.error;
        if (err === 'authorization_pending') continue;
        if (err === 'slow_down') {
            intervalMs += 5000;
            continue;
        }
        if (err === 'expired_token' || err === 'access_denied') {
            throw new Error(errBody.error_description || err);
        }
        throw new Error(`xAI token poll failed (${tokenRes.status}): ${errBody.error_description || err || 'unknown'}`);
    }
    throw new Error('xAI device authorization expired');
}

export async function refreshXaiSession({ fetch, session, now = Date.now, signal } = {}) {
    if (!session?.refreshToken) throw new Error('No SuperGrok refresh token');
    const doFetch = fetch || globalThis.fetch;
    const res = await doFetch(XAI_TOKEN_URL, {
        method: 'POST',
        headers: FORM_HEADERS,
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: XAI_CLIENT_ID,
            refresh_token: session.refreshToken,
        }),
        signal,
    });
    if (!res.ok) throw new Error(`xAI refresh failed (${res.status}): ${await readError(res)}`);
    const next = xaiSessionFromTokenResponse(await parseJson(res), now());
    return keepPriorRefresh(next, session.refreshToken);
}
