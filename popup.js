// popup.js - FoxVox Extended popup controller

function getActiveTab(callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        callback(tabs[0]);
    });
}

// ============================================================
// Tab switching
// ============================================================

function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.tab;

            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            document.getElementById(`tab-${target}`).classList.add('active');
        });
    });
}

// ============================================================
// Settings tab
// ============================================================

// Show the configured model name next to the checkbox label in the Bias tab
function updateModelHints(stored) {
    const ollamaHint = document.getElementById('ollama-model-hint');
    const lmstudioHint = document.getElementById('lmstudio-model-hint');
    if (ollamaHint) {
        const m = stored['key_ollama-model'];
        ollamaHint.textContent = m ? `(${m})` : '(no model set)';
    }
    if (lmstudioHint) {
        const m = stored['key_lmstudio-model'];
        lmstudioHint.textContent = m ? `(${m})` : '';
    }
}

const KEY_FIELDS = ['openai', 'anthropic', 'gemini', 'grok'];
const LOCAL_FIELDS = ['ollama-url', 'ollama-model', 'lmstudio-url', 'lmstudio-model'];
const STORAGE_KEYS = [
    ...KEY_FIELDS.map(k => `key_${k}`),
    ...LOCAL_FIELDS.map(k => `key_${k}`)
];

async function testLocalConnection(type, baseUrl) {
    const statusEl = document.getElementById(`${type}-test-status`);
    if (!baseUrl) {
        statusEl.textContent = 'Enter a URL first.';
        statusEl.style.color = '#888';
        return;
    }
    statusEl.textContent = 'Testing...';
    statusEl.style.color = '#888';

    try {
        const base = baseUrl.replace(/\/$/, '');
        const endpoint = type === 'ollama'
            ? `${base}/api/tags`
            : `${base}/v1/models`;

        const response = await fetch(endpoint, { method: 'GET' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        let modelList = [];

        if (type === 'ollama') {
            modelList = (data.models || []).map(m => m.name);
        } else {
            modelList = (data.data || []).map(m => m.id);
        }

        if (modelList.length > 0) {
            statusEl.textContent = `✓ Connected. Available: ${modelList.join(', ')}`;
            const modelInput = document.getElementById(`key-${type}-model`);
            if (modelInput && !modelInput.value.trim()) {
                modelInput.value = modelList[0];
                const stored = { [`key_${type}-model`]: modelList[0] };
                chrome.storage.local.set(stored);
                updateModelHints(stored);
            }
        } else {
            statusEl.textContent = type === 'ollama'
                ? '✓ Connected — no models pulled yet (run: ollama pull <model>)'
                : '✓ Connected — no model loaded in LM Studio yet';
        }
        statusEl.style.color = '#090';
    } catch (e) {
        statusEl.textContent = `✗ ${e.message}. Check URL and CORS settings (see note below).`;
        statusEl.style.color = '#c00';
    }
}

function initSettings() {
    // Load saved keys
    chrome.storage.local.get(STORAGE_KEYS, (result) => {
        KEY_FIELDS.forEach(k => {
            const stored = result[`key_${k}`];
            if (stored) document.getElementById(`key-${k}`).value = stored;
        });
        LOCAL_FIELDS.forEach(k => {
            const stored = result[`key_${k}`];
            if (stored) document.getElementById(`key-${k}`).value = stored;
        });
        // Populate model hints in the Bias tab
        updateModelHints(result);
        const lmUrl = document.getElementById('key-lmstudio-url').value.trim() || 'http://localhost:1234';
        testLocalConnection('lmstudio', lmUrl);
    });

    // Show/hide toggles
    document.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = document.getElementById(btn.dataset.target);
            input.type = input.type === 'password' ? 'text' : 'password';
        });
    });

    // Test local connection buttons
    document.getElementById('test-ollama-btn').addEventListener('click', () => {
        const url = document.getElementById('key-ollama-url').value.trim() || 'http://localhost:11434';
        testLocalConnection('ollama', url);
    });
    document.getElementById('test-lmstudio-btn').addEventListener('click', () => {
        const url = document.getElementById('key-lmstudio-url').value.trim() || 'http://localhost:1234';
        testLocalConnection('lmstudio', url);
    });

    initOAuthControls();

    // Save button
    document.getElementById('save-keys-btn').addEventListener('click', () => {
        const obj = {};
        KEY_FIELDS.forEach(k => {
            const val = document.getElementById(`key-${k}`).value.trim();
            if (val) obj[`key_${k}`] = val;
        });
        LOCAL_FIELDS.forEach(k => {
            const val = document.getElementById(`key-${k}`).value.trim();
            if (val) obj[`key_${k}`] = val;
        });

        // Also keep legacy 'openai' key in sync for the Rewrite module
        if (obj.key_openai) obj['openai'] = obj.key_openai;

        chrome.storage.local.set(obj, () => {
            const status = document.getElementById('save-status');
            status.textContent = 'Keys saved!';
            setTimeout(() => { status.textContent = ''; }, 2000);

            updateModelHints(obj);

            if (obj.key_openai) {
                chrome.runtime.sendMessage({
                    action: 'push_openai_to_background',
                    key: obj.key_openai,
                    url: ''
                });
            }
        });
    });
}

function oauthEls(provider) {
    return {
        start: document.getElementById(`${provider}-oauth-btn`),
        logout: document.getElementById(`${provider}-oauth-logout`),
        status: document.getElementById(`${provider}-oauth-status`),
        code: document.getElementById(`${provider}-oauth-code`),
    };
}

function applyOAuthStatus(provider, session) {
    const { start, logout, status, code } = oauthEls(provider);
    if (!start) return;
    if (session?.signedIn) {
        start.hidden = true;
        logout.hidden = false;
        if (code) code.textContent = '';
        if (status) status.textContent = session.email ? `Signed in as ${session.email}` : 'Signed in';
    } else {
        start.hidden = false;
        logout.hidden = true;
    }
}

function bindOAuth(provider) {
    const els = oauthEls(provider);
    els.start.addEventListener('click', () => {
        els.start.disabled = true;
        els.status.textContent = 'Starting…';
        chrome.runtime.sendMessage({ action: 'start_oauth', provider }, (res) => {
            els.start.disabled = false;
            if (chrome.runtime.lastError || !res?.ok) {
                els.status.textContent = res?.error || chrome.runtime.lastError?.message || 'Could not start login';
                return;
            }
            els.code.textContent = res.userCode;
            els.status.textContent = 'Enter this code in the tab that opened, then wait here.';
        });
    });
    els.logout.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'logout_oauth', provider }, () => {
            applyOAuthStatus(provider, null);
            els.status.textContent = 'Signed out.';
            els.code.textContent = '';
        });
    });
}

function initOAuthControls() {
    bindOAuth('xai');
    bindOAuth('codex');
    chrome.runtime.sendMessage({ action: 'oauth_status' }, (res) => {
        if (!res?.ok) return;
        applyOAuthStatus('xai', res.status.xai);
        applyOAuthStatus('codex', res.status.codex);
    });
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'oauth_completed') {
            applyOAuthStatus(message.provider, { signedIn: true, email: message.email });
            const { status, code } = oauthEls(message.provider);
            if (code) code.textContent = '';
            if (status) status.textContent = message.email ? `Signed in as ${message.email}` : 'Signed in';
        }
        if (message.action === 'oauth_error') {
            const { status, start } = oauthEls(message.provider);
            if (start) start.hidden = false;
            if (status) status.textContent = message.message || 'Login failed';
        }
    });
}

// ============================================================
// Bias Check tab
// ============================================================

function initBiasCheck(tab) {
    const checkboxes = document.querySelectorAll('#model-checkboxes input[type="checkbox"]');
    const warning = document.getElementById('model-count-warning');
    const biasBtn = document.getElementById('bias-button');
    const biasStatus = document.getElementById('bias-status');

    function validateSelection() {
        const selected = [...checkboxes].filter(c => c.checked);
        if (selected.length < 1) {
            warning.textContent = 'Select at least 1 model.';
            biasBtn.disabled = true;
        } else if (selected.length > 7) {
            warning.textContent = 'Select at most 7 models.';
            biasBtn.disabled = true;
        } else {
            warning.textContent = '';
            biasBtn.disabled = false;
        }
    }

    checkboxes.forEach(c => c.addEventListener('change', validateSelection));
    validateSelection();

    // Restore web context toggle state
    const webToggle = document.getElementById('web-context-toggle');
    webToggle.checked = localStorage.getItem('web_context') === 'true';
    webToggle.addEventListener('change', () => localStorage.setItem('web_context', webToggle.checked));

    biasBtn.addEventListener('click', () => {
        const selected = [...checkboxes].filter(c => c.checked).map(c => c.value);
        if (selected.length < 1 || selected.length > 6) return;

        const analysisType = document.getElementById('analysis-type').value;
        const webContext   = webToggle.checked;

        biasBtn.disabled = true;
        biasStatus.textContent = webContext ? 'Fetching news context…' : 'Sending to AI models…';

        chrome.runtime.sendMessage({
            action: 'run_bias_check',
            id: tab.id,
            selectedProviders: selected,
            analysisType,
            webContext
        });
    });

    // Listen for completion/error from background
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'bias_check_completed') {
            biasBtn.disabled = false;
            biasStatus.textContent = 'Done! See panel on the page.';
            setTimeout(() => { biasStatus.textContent = ''; }, 4000);
        }
        if (message.action === 'bias_check_error') {
            biasBtn.disabled = false;
            biasStatus.textContent = `Error: ${message.message}`;
        }
    });
}

// ============================================================
// Rewrite tab (original logic, preserved)
// ============================================================

let generate_button_state = {
    isGenerating: false,
    currentEmojiIndex: 0,
    emojiInterval: 0
};

const loadedState = localStorage.getItem('state');
if (loadedState) {
    generate_button_state = JSON.parse(loadedState);
}

function startEmojiAnimation() {
    let generateButton = document.getElementById('generate-button');
    generate_button_state.isGenerating = true;
    const emoji = ['🦊', '🦊 🦊', '🦊 🦊 🦊'];

    generate_button_state.emojiInterval = setInterval(() => {
        generateButton.innerText = `Generating... ${emoji[generate_button_state.currentEmojiIndex]}`;
        generate_button_state.currentEmojiIndex = (generate_button_state.currentEmojiIndex + 1) % emoji.length;
        localStorage.setItem('state', JSON.stringify(generate_button_state));
    }, 500);
}

function stopEmojiAnimation() {
    let generateButton = document.getElementById('generate-button');
    generate_button_state.isGenerating = false;
    clearInterval(generate_button_state.emojiInterval);
    generateButton.innerText = 'Rewrite the website!';
    localStorage.setItem('state', JSON.stringify(generate_button_state));
}

export function setup(tab, url) {
    return new Promise((resolve, reject) => {
        fetch(chrome.runtime.getURL('/config.json'))
            .then(response => response.json())
            .then(data => {
                const templates = data.templates;

                chrome.runtime.sendMessage({
                    action: 'setup',
                    id: tab.id,
                    url: url.hostname + url.pathname,
                    templates: templates,
                    key: data.api.key
                });

                let radio_container = document.getElementById('radio-container');

                Object.values(templates).forEach(template => {
                    let label = document.createElement('label');
                    let input = document.createElement('input');
                    let span = document.createElement('span');

                    input.type = 'radio';
                    input.name = 'view';
                    input.value = template.name;
                    input.id = `view-${template.name}`;

                    span.innerText = template.name;

                    label.htmlFor = `view-${template.name}`;

                    label.appendChild(input);
                    label.appendChild(span);

                    input.addEventListener('change', async () => {
                        localStorage.setItem('chosen_radio', input.id);
                        chrome.runtime.sendMessage({
                            action: 'set_template',
                            id: tab.id,
                            url: url.hostname + url.pathname,
                            template: template,
                        });
                    });

                    chrome.runtime.onMessage.addListener((message) => {
                        if (message.action === 'template_cached' && message.template_name === template.name) {
                            span.innerText = template.name + ' ✅';
                        }
                        if (message.action === 'cache_deleted' && message.template_name === template.name) {
                            span.innerText = template.name;
                        }
                    });

                    radio_container.appendChild(label);
                });

                if (localStorage.getItem('chosen_radio')) {
                    const radio = document.getElementById(localStorage.getItem('chosen_radio'));
                    if (radio) {
                        radio.checked = true;
                        let inputValue = radio.value;
                        let templatesArray = Object.values(templates);
                        let foundTemplate = templatesArray.find(t => t.name === inputValue);
                        chrome.runtime.sendMessage({
                            action: 'set_template',
                            id: tab.id,
                            url: url.hostname + url.pathname,
                            template: foundTemplate,
                        });
                    }
                }

                function decodeBase64(str) {
                    return decodeURIComponent(atob(str).split('').map(function (c) {
                        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
                    }).join(''));
                }

                // Restore saved provider selection
                const savedProvider = localStorage.getItem('rewrite_provider');
                const providerSel = document.getElementById('rewrite-provider');
                if (providerSel) providerSel.value = savedProvider || 'lmstudio';
                providerSel.addEventListener('change', (e) => {
                    localStorage.setItem('rewrite_provider', e.target.value);
                });

                document.getElementById('generate-button').addEventListener('click', async () => {
                    const provider = document.getElementById('rewrite-provider').value;
                    chrome.runtime.sendMessage({
                        action: 'generate',
                        id: tab.id,
                        url: url.hostname + url.pathname,
                        rewriteProvider: provider
                    });
                });

                resolve(); // Only resolve after templates are built and listeners attached
            })
            .catch((error) => {
                console.log('Error loading config:', error);
                const status = document.getElementById('status');
                if (status) status.textContent = 'Error loading config.';
                reject(error);
            });
    });
}

// ============================================================
// Init
// ============================================================

document.addEventListener('DOMContentLoaded', async function () {
    initTabs();
    initSettings();

    getActiveTab(function (tab) {
        // Guard: chrome:// and other restricted URLs can't be scripted
        if (!tab || !tab.url || !tab.url.startsWith('http')) {
            document.getElementById('status').textContent = 'Not available on this page.';
            document.getElementById('generate-button').disabled = true;
            document.getElementById('bias-button').disabled = true;
            return;
        }

        const url = new URL(tab.url);

        initBiasCheck(tab);

        // Register message listeners before setup so nothing is missed
        chrome.runtime.onMessage.addListener((message) => {
            if (message.action === 'generation_initialized') {
                startEmojiAnimation();
            }
            if (message.action === 'generation_completed') {
                stopEmojiAnimation();
            }
            if (message.action === 'push_openai_to_popup') {
                const keyInput = document.getElementById('key-openai');
                if (keyInput && message.openai && message.openai !== 'insert OpenAI API key') {
                    keyInput.value = message.openai;
                }
            }
            if (message.action === 'close_popup') {
                window.close();
            }
        });

        setup(tab, url).then(() => {
            chrome.runtime.sendMessage({
                action: 'setup_finished',
                id: tab.id,
                url: url.hostname + url.pathname,
            });
        });
    });
});
