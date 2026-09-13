import { tokenNeedsRefresh } from './oauth-lib.js';
import { runXaiDeviceLogin, refreshXaiSession } from './oauth-xai.js';
import { runCodexDeviceLogin, refreshCodexSession } from './oauth-codex.js';

export const OAUTH_KEYS = { xai: 'oauth_xai', codex: 'oauth_codex' };

const aborts = { xai: null, codex: null };
const keepAlives = { xai: null, codex: null };

function storageGet(keys) {
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}
function storageSet(obj) {
    return new Promise(resolve => chrome.storage.local.set(obj, resolve));
}

function startKeepAlive(provider) {
    stopKeepAlive(provider);
    keepAlives[provider] = setInterval(() => chrome.storage.local.get('_ka', () => {}), 20000);
}
function stopKeepAlive(provider) {
    if (keepAlives[provider]) {
        clearInterval(keepAlives[provider]);
        keepAlives[provider] = null;
    }
}

export function cancelOAuth(provider) {
    aborts[provider]?.abort();
    aborts[provider] = null;
    stopKeepAlive(provider);
}

export async function logoutOAuth(provider) {
    cancelOAuth(provider);
    await storageSet({ [OAUTH_KEYS[provider]]: null });
}

function publicSession(session) {
    if (!session?.accessToken) return null;
    return { email: session.email || '', accountId: session.accountId || '', signedIn: true };
}

export async function oauthStatus() {
    const stored = await storageGet([OAUTH_KEYS.xai, OAUTH_KEYS.codex]);
    return {
        xai: publicSession(stored[OAUTH_KEYS.xai]),
        codex: publicSession(stored[OAUTH_KEYS.codex]),
    };
}

export async function freshSession(provider) {
    const key = OAUTH_KEYS[provider];
    const stored = await storageGet([key]);
    let session = stored[key];
    if (!session?.accessToken) return null;
    if (!tokenNeedsRefresh(session)) return session;
    try {
        session = provider === 'xai'
            ? await refreshXaiSession({ session })
            : await refreshCodexSession({ session });
        await storageSet({ [key]: session });
        return session;
    } catch (e) {
        console.warn('[FoxVox] OAuth refresh failed:', provider, e);
        return session;
    }
}

export function startOAuth(provider) {
    cancelOAuth(provider);
    const ac = new AbortController();
    aborts[provider] = ac;
    startKeepAlive(provider);

    return new Promise((resolve, reject) => {
        let handedDevice = false;
        const run = provider === 'xai' ? runXaiDeviceLogin : runCodexDeviceLogin;
        run({
            openUrl: (url) => chrome.tabs.create({ url }),
            onDevice: (device) => {
                handedDevice = true;
                resolve({
                    userCode: device.userCode,
                    verificationUrl: device.verificationUrl,
                });
            },
            signal: ac.signal,
        }).then(async (session) => {
            await storageSet({ [OAUTH_KEYS[provider]]: session });
            chrome.runtime.sendMessage({
                action: 'oauth_completed',
                provider,
                email: session.email || '',
            }).catch(() => {});
        }).catch((err) => {
            if (err?.message === 'Login cancelled') return;
            if (!handedDevice) reject(err);
            else {
                chrome.runtime.sendMessage({
                    action: 'oauth_error',
                    provider,
                    message: err.message || String(err),
                }).catch(() => {});
            }
        }).finally(() => {
            if (aborts[provider] === ac) aborts[provider] = null;
            stopKeepAlive(provider);
        });
    });
}
