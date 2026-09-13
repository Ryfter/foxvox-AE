import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildCodexHeaders,
    buildCodexRequestBody,
    collectResponsesSseText,
} from '../codex-api.js';

describe('buildCodexHeaders', () => {
    it('sends bearer, account id, and an honest originator', () => {
        const headers = buildCodexHeaders({ accessToken: 'tok', accountId: 'acc_1' });
        assert.equal(headers.Authorization, 'Bearer tok');
        assert.equal(headers['ChatGPT-Account-Id'], 'acc_1');
        assert.equal(headers.originator, 'foxvox-extended');
        assert.equal(headers['OpenAI-Beta'], 'responses=experimental');
        assert.ok(headers.session_id);
    });
});

describe('buildCodexRequestBody', () => {
    it('uses store:false and puts the system prompt in instructions', () => {
        const body = buildCodexRequestBody({
            model: 'gpt-5.4',
            instructions: 'Be a fox',
            userText: 'hello',
        });
        assert.equal(body.store, false);
        assert.equal(body.stream, true);
        assert.equal(body.model, 'gpt-5.4');
        assert.equal(body.instructions, 'Be a fox');
        assert.deepEqual(body.input, [{ role: 'user', content: 'hello' }]);
    });
});

describe('collectResponsesSseText', () => {
    it('concatenates output_text deltas from SSE', () => {
        const sse = [
            'event: response.output_text.delta',
            'data: {"type":"response.output_text.delta","delta":"Hel"}',
            '',
            'data: {"type":"response.output_text.delta","delta":"lo"}',
            '',
            'data: [DONE]',
            '',
        ].join('\n');
        assert.equal(collectResponsesSseText(sse), 'Hello');
    });

    it('falls back to completed response output_text', () => {
        const sse = 'data: {"type":"response.completed","response":{"output_text":"done"}}\n\n';
        assert.equal(collectResponsesSseText(sse), 'done');
    });
});
