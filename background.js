import {clear_object_stores, fetch_from_object_store, open_indexDB, push_to_object_store} from "./database.js";
import {CoT} from "./generation.js";
import {runBiasAnalysis} from "./bias.js";

function collect_content() {
    const TEXT_BOUNDARY_MIN = 20;

    function get_position(element) {
        let top = 0, left = 0;
        while (element) {
            top += element.offsetTop || 0;
            left += element.offsetLeft || 0;
            element = element.offsetParent;
        }
        return {top, left};
    }

    let nodeWeightCache = new Map();

    function calculate_weight(node) {
        if (nodeWeightCache.has(node)) {
            return nodeWeightCache.get(node);
        }

        let htmlWeight = 0;
        let contentWeight = 0;

        if (node.nodeType === 3) { //Checking if nodeType is TEXT_NODE
            contentWeight = node.textContent.length;
            htmlWeight = 0;
        } else if (node.nodeType === 8) { //Checking if nodeType is COMMENT_NODE
            contentWeight = 0;
            htmlWeight = node.nodeValue.length;
        } else {
            Array.from(node.childNodes).forEach(child => {
                const {htmlWeight: childHtmlWeight, contentWeight: childContentWeight} = calculate_weight(child);
                htmlWeight += childHtmlWeight;
                contentWeight += childContentWeight;
            });
            try {
                if (node.outerHTML && node.innerHTML) {
                    htmlWeight += node.outerHTML.length - node.innerHTML.length;
                } else if (node.outerHTML) {
                    htmlWeight += node.outerHTML.length;
                }
            } catch (error) {
                console.warn(node, error);
            }
        }

        const result = {htmlWeight, contentWeight};
        nodeWeightCache.set(node, result);
        return result;
    }

    function sigmoid(x, b = 0.5, a = 1) {
        return 1 / (1 + Math.exp(-a * (x - b)));
    }

    function decompose(parentWeight, childrenWeights) {
        const {htmlWeight: parentHtmlWeight, contentWeight: parentContentWeight} = parentWeight;
        const totalChildHtmlWeight = childrenWeights.reduce((sum, weight) => sum + weight.htmlWeight, 0);
        const totalChildContentWeight = childrenWeights.reduce((sum, weight) => sum + weight.contentWeight, 0);

        const htmlWeightReduction = parentHtmlWeight - totalChildHtmlWeight;
        const contentWeightLoss = parentContentWeight - totalChildContentWeight;

        const htmlWeightFactor = sigmoid(parentHtmlWeight / 500, 0.5, 10); // Adjust '10' for steepness
        console.log(htmlWeightFactor);
        const contentWeightFactor = sigmoid(totalChildContentWeight / parentContentWeight, 0.5, 10);
        console.log(contentWeightFactor)

        const weightedHtmlWeightReduction = htmlWeightReduction * htmlWeightFactor;
        const weightedContentWeightLoss = contentWeightLoss * (1 - contentWeightFactor);
        console.log([weightedHtmlWeightReduction, weightedContentWeightLoss]);

        return totalChildContentWeight >= TEXT_BOUNDARY_MIN && weightedHtmlWeightReduction > weightedContentWeightLoss;
    }

    function traverse_dom(node) {
        let bestNodes = [];

        function traverse(node) {
            const {htmlWeight, contentWeight} = calculate_weight(node);
            console.log([node, htmlWeight, contentWeight])

            if (!node.children || node.children.length === 0) {
                if (contentWeight >= TEXT_BOUNDARY_MIN && node.tagName !== 'SCRIPT') {
                    bestNodes.push(node);
                }
                return;
            }

            const childrenWeights = Array.from(node.children).map(child => calculate_weight(child));

            if (decompose({htmlWeight, contentWeight}, childrenWeights)) {
                Array.from(node.children).forEach(child => traverse(child));
            } else {
                if (contentWeight >= TEXT_BOUNDARY_MIN && node.tagName !== 'SCRIPT') {
                    bestNodes.push(node);
                }
            }
            console.log(node, htmlWeight, contentWeight)
        }

        traverse(node);
        console.log("Best nodes:", bestNodes)
        return bestNodes;
    }

    function get_xpath(node) {
        const parts = [];

        for (; node && node.nodeType === 1; node = node.parentNode) { //Checking if nodeType is ELEMENT_NODE
            let index = 0;
            for (let sibling = node.previousSibling; sibling; sibling = sibling.previousSibling) {
                if (sibling.nodeType === 10) continue; //Checking if nodeType is DOCUMENT_NODE
                if (sibling.nodeName === node.nodeName) ++index;
            }

            const nodeName = node.nodeName.toLowerCase();
            const part = (index ? nodeName + '[' + (index + 1) + ']' : nodeName);
            parts.unshift(part);
        }

        return parts.length > 0 ? '/' + parts.join('/') : '';
    }

    function validate_node(orig_node, node) {
        console.log([orig_node, node])
        return orig_node.innerText && orig_node.innerText.length > 40 && orig_node.offsetWidth && orig_node.offsetHeight && node.innerHTML && node.plainText && orig_node.tagName !== 'SCRIPT'
    }

    const root = document.body
    let nodes = [];
    console.log(root)

    function push(node) {
        let {top, left} = get_position(node);
        let minimal = {
            xpath: get_xpath(node),
            layout: {
                left: left,
                top: top,
            },
            innerHTML: node.innerHTML,
            plainText: node.textContent,
        }

        if (validate_node(node, minimal)) {
            nodes.push(minimal);
        }
    }

    traverse_dom(root).forEach(node => push(node));

    console.log(nodes)
    return nodes;
}

/*
--###--
Generation (DOESN'T WORK)
--###--
*/

async function* generate(nodes, template, provider, apiKeys) {
    const promises = nodes.map(async node => {
        console.log('[FoxVox] CoT launched for node', node.xpath, 'with provider', provider);
        const html = await CoT(provider, apiKeys, template, node.innerHTML);
        console.log('[FoxVox] CoT finished for node', node.xpath);
        return { xpath: node.xpath, html };
    });

    for (const promise of promises) {
        const completion = await promise;
        if (completion.html) yield completion;
    }
}

/*
--###--
SETUP
--###--
*/

chrome.webNavigation.onCompleted.addListener(async function (details) {
    if (details.frameId === 0) {
        await clear_object_stores(new URL(details.url).hostname + new URL(details.url).pathname);

        chrome.runtime.sendMessage({
            action: "close_popup",
        });
    }
});


function push_cached_template(request) {
    fetch_from_object_store(request.url, 'original').then(original_nodes => {
        console.log("Original Nodes:", original_nodes)
        original_nodes.forEach(async original_node => {
            const xpath = original_node.xpath;
            const html = original_node.innerHTML;

            const func = function (xpath, html) {
                const node = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;

                if (node) {
                    node.innerHTML = html;
                } else {
                    console.log(`No element matches the provided XPath: ${xpath}`);
                }
            }

            await chrome.scripting.executeScript({
                target: {tabId: request.id},
                function: func,
                args: [xpath, html]
            });

        });
    });

    console.log("Original pushed...")

    console.log("Fetching template", request.template.name)
    // Then fetch and push the chosen template
    fetch_from_object_store(request.url, request.template.name).then(nodes => {
        console.log("Template Nodes:", nodes)
        nodes.forEach(async node => {
            const xpath = node.xpath;
            const html = node.html;

            const func = function (xpath, html) {
                const node = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;

                if (node) {
                    node.innerHTML = html;
                } else {
                    console.log(`No element matches the provided XPath: ${xpath}`);
                }
            }

            await chrome.scripting.executeScript({
                target: {tabId: request.id},
                function: func,
                args: [xpath, html]
            });

        });
    });
}

async function process_request(request) {
    if (request.action === "setup") {
        console.log('Setting up ...')
        open_indexDB(request.url, Object.values(request.templates).map(template => template.name)).then(async () => {
                let result;
                try {
                    result = await chrome.scripting.executeScript({
                        target: {tabId: request.id},
                        func: collect_content
                    });
                } catch (e) {
                    console.warn(e.message || e);
                    return;
                }
                const nodes = result[0].result
                push_to_object_store(request.url, 'original', nodes)
                    .then(() => {
                    }).catch(console.error);
            }
        )
    }

    if (request.action === "set_template") {
        let obj = {};
        obj['template_' + request.url] = request.template;
        chrome.storage.local.set(obj, function () {
            console.log('Template for', request.url, 'saved:', request.template);
            push_cached_template(request);
        });
    }

    if (request.action === "clear-cache") {
        await clear_object_stores(request.url)
    }

    if (request.action === "push_openai_to_background") {
        let obj = {};
        obj['openai'] = request.key;
        chrome.storage.local.set(obj, function () {
            console.log('OpenAI key set');
        });

        chrome.runtime.sendMessage({
            action: "push_openai_to_popup",
            openai: request.key
        });
    }

    if (request.action === "setup_finished") {
        chrome.storage.local.get('openai', function (result) {
            let api_key = result['openai']

            if (typeof api_key === "undefined") {
                api_key = "insert OpenAI API key"
            }

            chrome.runtime.sendMessage({
                action: "push_openai_to_popup",
                openai: api_key
            });
        })
    }

    if (request.action === "generate") {
        chrome.runtime.sendMessage({ action: "generation_initialized" });

        new Promise(async (resolve, reject) => {
            try {
                const original = await fetch_from_object_store(request.url, 'original');
                const storageKeys = [
                    'template_' + request.url,
                    'key_openai', 'key_anthropic', 'key_gemini', 'key_grok',
                    'key_ollama-url', 'key_ollama-model', 'key_lmstudio-url', 'key_lmstudio-model'
                ];
                chrome.storage.local.get(storageKeys, async function (result) {
                    if (!result['template_' + request.url]) {
                        reject('No template selected.');
                        return;
                    }
                    const apiKeys = {
                        openai:        result.key_openai,
                        anthropic:     result.key_anthropic,
                        gemini:        result.key_gemini,
                        grok:          result.key_grok,
                        ollama_url:    result['key_ollama-url'],
                        ollama_model:  result['key_ollama-model'],
                        lmstudio_url:  result['key_lmstudio-url'],
                        lmstudio_model: result['key_lmstudio-model']
                    };
                    const provider = request.rewriteProvider || 'openai';

                    try {
                        let nodes = [];
                        for await (const node of generate(original, result['template_' + request.url], provider, apiKeys)) {
                            nodes.push(node);
                            const xpath = node.xpath;
                            const html = node.html;
                            const func = function (xpath, html) {
                                const node = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                                if (node) { node.innerHTML = html; }
                                else { console.log(`No element matches XPath: ${xpath}`); }
                            };
                            chrome.scripting.executeScript({ target: { tabId: request.id }, function: func, args: [xpath, html] });
                        }
                        if (nodes.length) {
                            await push_to_object_store(request.url, result['template_' + request.url].name, nodes);
                        }
                        console.log('[FoxVox] Page rewritten.');
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                });
            } catch (error) {
                reject(error);
            }
        }).then(() => {
            chrome.storage.local.get(['template_' + request.url], function (result) {
                chrome.runtime.sendMessage({ action: "template_cached", template_name: result['template_' + request.url].name });
            });
            chrome.runtime.sendMessage({ action: "generation_completed" });
        }).catch(error => {
            console.error('[FoxVox] Generation error:', error);
            chrome.runtime.sendMessage({ action: "generation_completed" });
        });
    }
}

/*
--###--
Bias panel injection helpers
--###--
*/

function showErrorPanel(message) {
    const existing = document.getElementById('foxvox-bias-panel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'foxvox-bias-panel';
    panel.style.cssText = [
        'position:fixed', 'right:0', 'top:0', 'width:420px', 'height:100vh',
        'background:white', 'z-index:2147483647',
        'box-shadow:-4px 0 20px rgba(0,0,0,0.25)',
        'font-family:Arial,sans-serif',
        'display:flex', 'flex-direction:column',
        'align-items:center', 'justify-content:center',
        'padding:24px', 'text-align:center'
    ].join(';');
    panel.innerHTML = [
        '<div style="font-size:36px;">⚠</div>',
        '<div style="color:#c00;font-size:14px;font-weight:bold;margin-top:10px;">Analysis Failed</div>',
        '<div style="color:#555;font-size:12px;margin-top:8px;line-height:1.6;">' + message.replace(/</g, '&lt;') + '</div>',
        '<button onclick="this.parentElement.remove()" style="margin-top:16px;background:#9e01ac;color:white;border:none;border-radius:4px;padding:7px 18px;cursor:pointer;font-size:13px;">Close</button>'
    ].join('');
    document.body.appendChild(panel);
}

function showLoadingPanel() {
    const existing = document.getElementById('foxvox-bias-panel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'foxvox-bias-panel';
    panel.style.cssText = [
        'position:fixed', 'right:0', 'top:0', 'width:420px', 'height:100vh',
        'background:white', 'z-index:2147483647',
        'box-shadow:-4px 0 20px rgba(0,0,0,0.25)',
        'font-family:Arial,sans-serif',
        'display:flex', 'flex-direction:column',
        'align-items:center', 'justify-content:center'
    ].join(';');
    panel.innerHTML = [
        '<div style="font-size:42px;">🦊</div>',
        '<div style="color:#9e01ac;font-size:16px;font-weight:bold;margin-top:12px;">Analyzing with multiple AIs...</div>',
        '<div style="color:#888;font-size:12px;margin-top:6px;">This may take 15–45 seconds</div>'
    ].join('');
    document.body.appendChild(panel);
}

function showResultsPanel(results, analysisType) {
    const existing = document.getElementById('foxvox-bias-panel');
    if (existing) existing.remove();

    const typeLabels = {
        factcheck: 'Fact Check',
        political: 'Political Analysis',
        summary: 'Balanced Summary'
    };

    const panel = document.createElement('div');
    panel.id = 'foxvox-bias-panel';
    panel.style.cssText = [
        'position:fixed', 'right:0', 'top:0', 'width:420px', 'height:100vh',
        'background:white', 'z-index:2147483647',
        'box-shadow:-4px 0 20px rgba(0,0,0,0.25)',
        'font-family:Arial,sans-serif',
        'display:flex', 'flex-direction:column', 'overflow:hidden'
    ].join(';');

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'background:#9e01ac;color:white;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;';
    header.innerHTML = [
        '<div>',
        '<div style="font-weight:bold;font-size:15px;">🦊 FoxVox Bias Analysis</div>',
        '<div style="font-size:11px;opacity:0.85;margin-top:2px;">' + (typeLabels[analysisType] || analysisType) + '</div>',
        '</div>'
    ].join('');

    const closeBtn = document.createElement('button');
    closeBtn.innerText = '✕';
    closeBtn.style.cssText = 'background:none;border:none;color:white;font-size:20px;cursor:pointer;padding:4px 6px;line-height:1;';
    closeBtn.onclick = () => panel.remove();
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // Content area
    const content = document.createElement('div');
    content.style.cssText = 'flex:1;overflow-y:auto;padding:14px;';

    results.forEach(result => {
        const card = document.createElement('div');
        card.style.cssText = 'border:2px solid ' + result.color + ';border-radius:8px;margin-bottom:16px;overflow:hidden;';

        const cardHeader = document.createElement('div');
        cardHeader.style.cssText = 'background:' + result.color + ';color:white;padding:8px 12px;font-weight:bold;font-size:13px;';
        cardHeader.innerText = result.name;
        card.appendChild(cardHeader);

        const cardBody = document.createElement('div');
        cardBody.style.cssText = 'padding:12px;font-size:12px;line-height:1.65;white-space:pre-wrap;color:#222;';
        cardBody.innerText = result.error
            ? '⚠ Error: ' + result.error
            : (result.analysis || 'No response received.');
        card.appendChild(cardBody);

        content.appendChild(card);
    });

    panel.appendChild(content);
    document.body.appendChild(panel);
}

/*
--###--
Bias check request handler
--###--
*/

// Fetch current news headlines from Google News RSS and return a context block
async function fetchNewsContext(query) {
    try {
        const q = encodeURIComponent(query.trim().slice(0, 120));
        const res = await fetch(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`);
        if (!res.ok) return null;
        const xml = await res.text();

        // Parse items via regex (DOMParser not available in MV3 service workers)
        const items = [];
        const itemRx = /<item>([\s\S]*?)<\/item>/g;
        let m;
        while ((m = itemRx.exec(xml)) !== null && items.length < 8) {
            const block = m[1];
            const titleMatch = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
            const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/);
            const dateMatch   = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
            const title  = titleMatch?.[1]?.trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') || '';
            if (!title) continue;
            const source = sourceMatch?.[1]?.trim() || '';
            const date   = dateMatch?.[1] ? new Date(dateMatch[1]).toLocaleDateString() : '';
            items.push(`• ${title}${source ? ` [${source}]` : ''}${date ? ` (${date})` : ''}`);
        }

        if (!items.length) return null;
        return `=== CURRENT NEWS CONTEXT (${new Date().toLocaleDateString()}) ===\n${items.join('\n')}\n=== END NEWS CONTEXT ===\n\n`;
    } catch (e) {
        console.warn('[FoxVox] News context fetch failed:', e);
        return null;
    }
}

async function handle_bias_check(request) {
    // 1. Collect page text + title
    let pageTextResult;
    try {
        pageTextResult = await chrome.scripting.executeScript({
            target: { tabId: request.id },
            func: () => ({ text: document.body.innerText, title: document.title })
        });
    } catch (e) {
        console.warn('Could not get page text for bias check:', e);
        chrome.runtime.sendMessage({ action: 'bias_check_error', message: 'Could not read page content.' });
        return;
    }
    const { text: pageText, title: pageTitle } = pageTextResult[0]?.result || { text: '', title: '' };

    // 1b. Optionally fetch Google News context
    let newsContext = '';
    if (request.webContext && pageTitle) {
        console.log('[FoxVox] Fetching news context for:', pageTitle);
        newsContext = (await fetchNewsContext(pageTitle)) || '';
        if (newsContext) console.log('[FoxVox] News context fetched OK');
    }

    // 2. Show loading panel on the page
    await chrome.scripting.executeScript({
        target: { tabId: request.id },
        func: showLoadingPanel
    });

    // 3. Load API keys (cloud + local model config) and run analysis
    const storageKeys = [
        'key_openai', 'key_anthropic', 'key_gemini', 'key_grok',
        'key_ollama-url', 'key_ollama-model', 'key_lmstudio-url', 'key_lmstudio-model'
    ];
    chrome.storage.local.get(storageKeys, async (stored) => {
        console.log('[FoxVox] Bias check storage dump:', JSON.stringify({
            'key_ollama-url':   stored['key_ollama-url'],
            'key_ollama-model': stored['key_ollama-model'],
            'key_lmstudio-url': stored['key_lmstudio-url'],
            'key_lmstudio-model': stored['key_lmstudio-model'],
            hasOpenAI:   !!stored.key_openai,
            hasAnthropic: !!stored.key_anthropic,
            hasGemini:   !!stored.key_gemini,
            hasGrok:     !!stored.key_grok
        }));
        console.log('[FoxVox] Selected providers:', request.selectedProviders);
        const apiKeys = {
            openai:          stored.key_openai,
            anthropic:       stored.key_anthropic,
            gemini:          stored.key_gemini,
            grok:            stored.key_grok,
            ollama_url:      stored['key_ollama-url'],
            ollama_model:    stored['key_ollama-model'],
            lmstudio_url:    stored['key_lmstudio-url'],
            lmstudio_model:  stored['key_lmstudio-model']
        };

        try {
            const results = await runBiasAnalysis(
                request.selectedProviders,
                apiKeys,
                request.analysisType,
                newsContext + pageText
            );

            // 4. Show results panel on the page
            await chrome.scripting.executeScript({
                target: { tabId: request.id },
                func: showResultsPanel,
                args: [results, request.analysisType]
            });

            chrome.runtime.sendMessage({ action: 'bias_check_completed' });
        } catch (e) {
            console.error('Bias analysis failed:', e);
            // Show error panel on the page so the loading spinner doesn't get stuck
            chrome.scripting.executeScript({
                target: { tabId: request.id },
                func: showErrorPanel,
                args: [e.message || 'Unknown error']
            });
            chrome.runtime.sendMessage({ action: 'bias_check_error', message: e.message });
        }
    });
}

chrome.runtime.onMessage.addListener(async function (request, sender, sendResponse) {
    if (request.action === 'run_bias_check') {
        await handle_bias_check(request);
        return true;
    }
    await process_request(request, sender, sendResponse);
    return true;
});