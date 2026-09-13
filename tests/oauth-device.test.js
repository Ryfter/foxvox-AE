import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runXaiDeviceLogin, refreshXaiSession } from '../oauth-xai.js';
import { runCodexDeviceLogin, refreshCodexSession } from '../oauth-codex.js';
import { XAI_DEVICE_CODE_URL, XAI_TOKEN_URL, CODEX_USERCODE_URL, CODEX_DEVICE_TOKEN_URL, CODEX_TOKEN_URL } from '../oauth-lib.js';

function jsonResponse(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
    };
}

describe('runXaiDeviceLogin', () => {
    it('opens the verification URL and returns a session after a pending poll', async () => {
        let tokenCalls = 0;
        const fetch = async (url) => {
            if (url === XAI_DEVICE_CODE_URL) {
                return jsonResponse({
                    device_code: 'dev',
                    user_code: 'CODE-1',
                    verification_uri: 'https://auth.x.ai/activate',
                    interval: 1,
                    expires_in: 60,
                });
            }
            if (url === XAI_TOKEN_URL) {
                tokenCalls += 1;
                if (tokenCalls === 1) {
                    return jsonResponse({ error: 'authorization_pending' }, 400);
                }
                return jsonResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 9 });
            }
            throw new Error('unexpected ' + url);
        };
        const opened = [];
        const seen = [];
        const session = await runXaiDeviceLogin({
            fetch,
            openUrl: (u) => opened.push(u),
            onDevice: (d) => seen.push(d.userCode),
            sleep: async () => {},
            now: () => 1000,
        });
        assert.deepEqual(opened, ['https://auth.x.ai/activate']);
        assert.deepEqual(seen, ['CODE-1']);
        assert.equal(session.accessToken, 'at');
        assert.equal(session.refreshToken, 'rt');
        assert.equal(session.expiresAt, 1000 + 9000);
        assert.equal(tokenCalls, 2);
    });

    it('honors slow_down by continuing to poll', async () => {
        let tokenCalls = 0;
        const fetch = async (url) => {
            if (url === XAI_DEVICE_CODE_URL) {
                return jsonResponse({
                    device_code: 'dev',
                    user_code: 'CODE-1',
                    verification_uri: 'https://auth.x.ai/activate',
                    interval: 1,
                    expires_in: 60,
                });
            }
            tokenCalls += 1;
            if (tokenCalls === 1) return jsonResponse({ error: 'slow_down' }, 400);
            return jsonResponse({ access_token: 'at', expires_in: 1 });
        };
        const session = await runXaiDeviceLogin({
            fetch,
            openUrl: () => {},
            sleep: async () => {},
            now: () => 0,
        });
        assert.equal(session.accessToken, 'at');
    });
});

describe('refreshXaiSession', () => {
    it('keeps the old refresh token when xAI omits it on refresh', async () => {
        const fetch = async () => jsonResponse({ access_token: 'new', expires_in: 10 });
        const next = await refreshXaiSession({
            fetch,
            session: { accessToken: 'old', refreshToken: 'keep-me', expiresAt: 1 },
            now: () => 0,
        });
        assert.equal(next.accessToken, 'new');
        assert.equal(next.refreshToken, 'keep-me');
    });
});

describe('runCodexDeviceLogin', () => {
    it('polls 403 as pending, then exchanges the server verifier', async () => {
        const calls = [];
        const fetch = async (url, opts) => {
            calls.push({ url, body: opts?.body, headers: opts?.headers });
            if (url === CODEX_USERCODE_URL) {
                return jsonResponse({ device_auth_id: 'did', user_code: 'AB-CD', interval: 1 });
            }
            if (url === CODEX_DEVICE_TOKEN_URL) {
                const polls = calls.filter(c => c.url === CODEX_DEVICE_TOKEN_URL).length;
                if (polls === 1) return jsonResponse({}, 403);
                return jsonResponse({ authorization_code: 'ac', code_verifier: 'cv' });
            }
            if (url === CODEX_TOKEN_URL) {
                return jsonResponse({
                    access_token: 'at',
                    refresh_token: 'rt',
                    expires_in: 5,
                    id_token: [
                        'hdr',
                        Buffer.from(JSON.stringify({
                            email: 'c@x.ai',
                            chatgpt_account_id: 'acc_c',
                        })).toString('base64url'),
                        'sig',
                    ].join('.'),
                });
            }
            throw new Error('unexpected ' + url);
        };
        const opened = [];
        const session = await runCodexDeviceLogin({
            fetch,
            openUrl: (u) => opened.push(u),
            sleep: async () => {},
            now: () => 0,
        });
        assert.equal(opened[0], 'https://auth.openai.com/codex/device');
        assert.equal(session.accessToken, 'at');
        assert.equal(session.accountId, 'acc_c');
        const exchange = calls.find(c => c.url === CODEX_TOKEN_URL);
        assert.match(String(exchange.body), /code_verifier=cv/);
        assert.match(String(exchange.body), /grant_type=authorization_code/);
    });
});

describe('refreshCodexSession', () => {
    it('posts a refresh_token grant', async () => {
        const fetch = async (url, opts) => {
            assert.equal(url, CODEX_TOKEN_URL);
            assert.match(String(opts.body), /grant_type=refresh_token/);
            return jsonResponse({ access_token: 'fresh', refresh_token: 'rt2', expires_in: 3 });
        };
        const next = await refreshCodexSession({
            fetch,
            session: { refreshToken: 'rt1' },
            now: () => 0,
        });
        assert.equal(next.accessToken, 'fresh');
        assert.equal(next.refreshToken, 'rt2');
    });
});
