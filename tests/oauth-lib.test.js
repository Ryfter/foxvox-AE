import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseXaiDevice,
    xaiSessionFromTokenResponse,
    tokenNeedsRefresh,
    isHttpForbidden,
    XAI_FORBIDDEN_MESSAGE,
    parseCodexUserCode,
    parseCodexGrant,
    isCodexPollPending,
    decodeJwtPayload,
    extractAccountId,
    extractEmail,
    sessionFromOAuthTokenResponse,
} from '../oauth-lib.js';

describe('parseXaiDevice', () => {
    it('reads RFC 8628 device-code fields and prefers the prefilled URL', () => {
        const device = parseXaiDevice({
            device_code: 'dev-1',
            user_code: 'ABCD-EFGH',
            verification_uri: 'https://auth.x.ai/activate',
            verification_uri_complete: 'https://auth.x.ai/activate?user_code=ABCD-EFGH',
            interval: 5,
            expires_in: 600,
        });
        assert.equal(device.deviceCode, 'dev-1');
        assert.equal(device.userCode, 'ABCD-EFGH');
        assert.equal(device.verificationUrl, 'https://auth.x.ai/activate?user_code=ABCD-EFGH');
        assert.equal(device.intervalMs, 5000);
        assert.equal(device.expiresIn, 600);
    });

    it('rejects http verification URLs', () => {
        assert.throws(() => parseXaiDevice({
            device_code: 'dev-1',
            user_code: 'ABCD',
            verification_uri: 'http://evil.example/activate',
        }), /https/);
    });

    it('rejects a response missing the user code', () => {
        assert.throws(() => parseXaiDevice({
            device_code: 'dev-1',
            verification_uri: 'https://auth.x.ai/activate',
        }), /user code/i);
    });
});

describe('xaiSessionFromTokenResponse', () => {
    it('stamps expires_at from expires_in using the provided now', () => {
        const session = xaiSessionFromTokenResponse({
            access_token: 'at',
            refresh_token: 'rt',
            expires_in: 3600,
        }, 1_000_000);
        assert.equal(session.accessToken, 'at');
        assert.equal(session.refreshToken, 'rt');
        assert.equal(session.expiresAt, 1_000_000 + 3600 * 1000);
    });

    it('defaults expires_in to 3600 when missing', () => {
        const session = xaiSessionFromTokenResponse({ access_token: 'at' }, 0);
        assert.equal(session.expiresAt, 3600 * 1000);
        assert.equal(session.refreshToken, '');
    });
});

describe('tokenNeedsRefresh', () => {
    it('is true when the token is inside the skew window', () => {
        const session = { expiresAt: 10_000 };
        assert.equal(tokenNeedsRefresh(session, 9_000, 2_000), true);
        assert.equal(tokenNeedsRefresh(session, 7_000, 2_000), false);
    });

    it('is true when there is no expiry', () => {
        assert.equal(tokenNeedsRefresh({}, 0, 1000), true);
    });
});

describe('xAI 403', () => {
    it('treats HTTP 403 as the SuperGrok-not-entitled case', () => {
        assert.equal(isHttpForbidden(403), true);
        assert.equal(isHttpForbidden(401), false);
        assert.match(XAI_FORBIDDEN_MESSAGE, /403/);
        assert.match(XAI_FORBIDDEN_MESSAGE, /API key/i);
    });
});

describe('parseCodexUserCode', () => {
    it('accepts device_auth_id and either user_code spelling', () => {
        const a = parseCodexUserCode({ device_auth_id: 'id-1', user_code: 'WXYZ-1234', interval: 5 });
        assert.equal(a.deviceAuthId, 'id-1');
        assert.equal(a.userCode, 'WXYZ-1234');
        assert.equal(a.intervalMs, 5000);
        const b = parseCodexUserCode({ device_auth_id: 'id-1', usercode: 'WXYZ-1234' });
        assert.equal(b.userCode, 'WXYZ-1234');
        assert.equal(b.intervalMs, 5000);
    });
});

describe('parseCodexGrant', () => {
    it('requires authorization_code and the server-issued verifier', () => {
        const grant = parseCodexGrant({
            authorization_code: 'ac',
            code_verifier: 'cv',
        });
        assert.equal(grant.authorizationCode, 'ac');
        assert.equal(grant.codeVerifier, 'cv');
        assert.throws(() => parseCodexGrant({ authorization_code: 'ac' }), /verifier/i);
    });
});

describe('isCodexPollPending', () => {
    it('treats 403 and 404 as still waiting, anything else as terminal', () => {
        assert.equal(isCodexPollPending(403), true);
        assert.equal(isCodexPollPending(404), true);
        assert.equal(isCodexPollPending(200), false);
        assert.equal(isCodexPollPending(401), false);
        assert.equal(isCodexPollPending(500), false);
    });
});

function b64url(obj) {
    return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function fakeJwt(payload) {
    return `hdr.${b64url(payload)}.sig`;
}

describe('Codex JWT claims', () => {
    it('extracts chatgpt_account_id from the namespaced auth claim', () => {
        const token = fakeJwt({
            email: 'Kev@Example.com',
            'https://api.openai.com/auth': { chatgpt_account_id: 'acc_123' },
        });
        assert.equal(extractAccountId(token), 'acc_123');
        assert.equal(extractEmail(token), 'kev@example.com');
    });

    it('prefers a top-level chatgpt_account_id', () => {
        const token = fakeJwt({ chatgpt_account_id: 'acc_top' });
        assert.equal(extractAccountId(token), 'acc_top');
    });

    it('returns undefined for garbage', () => {
        assert.equal(decodeJwtPayload('not-a-jwt'), undefined);
        assert.equal(extractAccountId('nope'), undefined);
    });
});

describe('sessionFromOAuthTokenResponse', () => {
    it('builds a Codex session with account id from the id_token', () => {
        const idToken = fakeJwt({
            email: 'a@b.c',
            'https://api.openai.com/auth': { chatgpt_account_id: 'acc_9' },
        });
        const session = sessionFromOAuthTokenResponse({
            access_token: 'at',
            refresh_token: 'rt',
            id_token: idToken,
            expires_in: 10,
        }, 0);
        assert.equal(session.accessToken, 'at');
        assert.equal(session.refreshToken, 'rt');
        assert.equal(session.accountId, 'acc_9');
        assert.equal(session.email, 'a@b.c');
        assert.equal(session.expiresAt, 10_000);
    });

    it('throws when access_token is missing', () => {
        assert.throws(() => sessionFromOAuthTokenResponse({}, 0), /access token/i);
    });
});
