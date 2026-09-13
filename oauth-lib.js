// Pure OAuth helpers — no chrome, no fetch. Tested in tests/oauth-lib.test.js.

export const XAI_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
export const XAI_SCOPE = 'openid profile email offline_access grok-cli:access api:access';
export const XAI_DEVICE_CODE_URL = 'https://auth.x.ai/oauth2/device/code';
export const XAI_TOKEN_URL = 'https://auth.x.ai/oauth2/token';
export const XAI_DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
export const XAI_FORBIDDEN_MESSAGE =
    'xAI returned 403. SuperGrok OAuth is not entitled for api.x.ai on this account. This is not retried. Use an xAI API key, or confirm SuperGrok / X Premium+ is active.';

export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const CODEX_USERCODE_URL = 'https://auth.openai.com/api/accounts/deviceauth/usercode';
export const CODEX_DEVICE_TOKEN_URL = 'https://auth.openai.com/api/accounts/deviceauth/token';
export const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
export const CODEX_DEVICE_REDIRECT_URI = 'https://auth.openai.com/deviceauth/callback';
export const CODEX_VERIFICATION_URL = 'https://auth.openai.com/codex/device';

const DEFAULT_POLL_MS = 5000;
const MIN_POLL_MS = 1000;
const MAX_POLL_MS = 15 * 60 * 1000;
const DEFAULT_EXPIRES_IN = 3600;

function nonEmpty(value) {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function intervalMs(raw) {
    const seconds = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_POLL_MS;
    const ms = Math.round(seconds * 1000);
    return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, ms));
}

function requireHttps(url, label) {
    if (typeof url !== 'string' || !url.startsWith('https://')) {
        throw new Error(`${label} must be an https URL`);
    }
    return url;
}

export function parseXaiDevice(payload) {
    const deviceCode = nonEmpty(payload?.device_code);
    const userCode = nonEmpty(payload?.user_code);
    if (!deviceCode) throw new Error('xAI device code response missing device_code');
    if (!userCode) throw new Error('xAI device code response missing user code');
    const complete = nonEmpty(payload?.verification_uri_complete);
    const base = nonEmpty(payload?.verification_uri);
    const verificationUrl = requireHttps(complete || base, 'verification_uri');
    return {
        deviceCode,
        userCode,
        verificationUrl,
        intervalMs: intervalMs(payload?.interval),
        expiresIn: typeof payload?.expires_in === 'number' && payload.expires_in > 0
            ? payload.expires_in
            : 600,
    };
}

export function xaiSessionFromTokenResponse(payload, now = Date.now()) {
    const accessToken = nonEmpty(payload?.access_token);
    if (!accessToken) throw new Error('xAI token response missing access_token');
    const expiresIn =
        typeof payload?.expires_in === 'number' && Number.isFinite(payload.expires_in) && payload.expires_in >= 0
            ? payload.expires_in
            : DEFAULT_EXPIRES_IN;
    return {
        accessToken,
        refreshToken: nonEmpty(payload?.refresh_token) || '',
        expiresAt: now + expiresIn * 1000,
        email: extractEmail(payload?.id_token, accessToken) || '',
    };
}

export function tokenNeedsRefresh(session, now = Date.now(), skewMs = 2 * 60 * 1000) {
    if (!session || typeof session.expiresAt !== 'number') return true;
    return now + skewMs >= session.expiresAt;
}

export function isHttpForbidden(status) {
    return status === 403;
}

export function parseCodexUserCode(payload) {
    const deviceAuthId = nonEmpty(payload?.device_auth_id);
    const userCode = nonEmpty(payload?.user_code) || nonEmpty(payload?.usercode);
    if (!deviceAuthId || !userCode) {
        throw new Error('ChatGPT device authorization response missing required fields');
    }
    return { deviceAuthId, userCode, intervalMs: intervalMs(payload?.interval) };
}

export function parseCodexGrant(payload) {
    const authorizationCode = nonEmpty(payload?.authorization_code);
    const codeVerifier = nonEmpty(payload?.code_verifier);
    if (!authorizationCode) throw new Error('ChatGPT device authorization missing authorization_code');
    if (!codeVerifier) throw new Error('ChatGPT device authorization missing server-issued verifier');
    return { authorizationCode, codeVerifier };
}

export function isCodexPollPending(status) {
    return status === 403 || status === 404;
}

export function decodeJwtPayload(token) {
    if (typeof token !== 'string') return undefined;
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) return undefined;
    try {
        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
        const json = typeof atob === 'function'
            ? atob(b64 + pad)
            : Buffer.from(parts[1], 'base64url').toString('utf8');
        const payload = JSON.parse(json);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
        return payload;
    } catch {
        return undefined;
    }
}

function usableId(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function extractAccountId(...tokens) {
    for (const token of tokens) {
        const payload = decodeJwtPayload(token);
        if (!payload) continue;
        const top = usableId(payload.chatgpt_account_id);
        if (top) return top;
        const ns = payload['https://api.openai.com/auth'];
        if (ns && typeof ns === 'object') {
            const namespaced = usableId(ns.chatgpt_account_id);
            if (namespaced) return namespaced;
        }
        const orgs = payload.organizations;
        if (Array.isArray(orgs) && orgs[0] && usableId(orgs[0].id)) return orgs[0].id.trim();
    }
    return undefined;
}

export function extractEmail(...tokens) {
    for (const token of tokens) {
        const payload = decodeJwtPayload(token);
        if (payload && typeof payload.email === 'string') return payload.email.toLowerCase();
    }
    return undefined;
}

export function sessionFromOAuthTokenResponse(payload, now = Date.now()) {
    const accessToken = nonEmpty(payload?.access_token);
    if (!accessToken) throw new Error('ChatGPT token response missing access token');
    const idToken = nonEmpty(payload?.id_token);
    const expiresIn =
        typeof payload?.expires_in === 'number' && Number.isFinite(payload.expires_in) && payload.expires_in >= 0
            ? payload.expires_in
            : DEFAULT_EXPIRES_IN;
    const computed = now + expiresIn * 1000;
    return {
        accessToken,
        refreshToken: nonEmpty(payload?.refresh_token) || '',
        expiresAt: Number.isFinite(computed) ? computed : now + DEFAULT_EXPIRES_IN * 1000,
        accountId: extractAccountId(idToken, accessToken) || '',
        email: extractEmail(idToken, accessToken) || '',
    };
}

export function keepPriorRefresh(nextSession, previousRefresh) {
    if (nextSession.refreshToken) return nextSession;
    return { ...nextSession, refreshToken: previousRefresh || '' };
}
