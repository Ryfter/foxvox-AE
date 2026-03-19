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

        // Heartbeat: keep service worker alive during slow/large local model inference
        const keepAlive = setInterval(() => chrome.storage.local.get('_ka', () => {}), 20000);

        new Promise(async (resolve, reject) => {
            try {
                const original = await fetch_from_object_store(request.url, 'original');
                const storageKeys = [
                    'template_' + request.url,
                    'key_openai', 'key_anthropic', 'key_gemini', 'key_grok',
                    'key_ollama-url', 'key_ollama-model', 'key_lmstudio-url', 'key_lmstudio-model'
                ];
                const result = await new Promise(resolve => chrome.storage.local.get(storageKeys, resolve));
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
            } catch (error) {
                reject(error);
            }
        }).then(() => {
            clearInterval(keepAlive);
            chrome.storage.local.get(['template_' + request.url], function (result) {
                chrome.runtime.sendMessage({ action: "template_cached", template_name: result['template_' + request.url].name });
            });
            chrome.runtime.sendMessage({ action: "generation_completed" });
        }).catch(error => {
            clearInterval(keepAlive);
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

function showLoadingPanel() {
    document.getElementById('foxvox-bias-panel')?.remove();
    document.getElementById('foxvox-bias-style')?.remove();
    const s = document.createElement('style');
    s.id = 'foxvox-bias-style';
    s.textContent = `#foxvox-bias-panel{position:fixed;top:0;right:0;width:380px;height:100vh;background:#fff;box-shadow:-3px 0 20px rgba(0,0,0,0.12);z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;flex-direction:column;animation:fvx-in .25s ease}@keyframes fvx-in{from{transform:translateX(380px)}to{transform:translateX(0)}}.fvx-head{padding:12px 14px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}.fvx-title{font-size:15px;font-weight:700;color:#0f172a}.fvx-loading{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;color:#64748b;font-size:13px}.fvx-spinner{width:34px;height:34px;border:3px solid #e2e8f0;border-top-color:#0f172a;border-radius:50%;animation:fvx-spin .8s linear infinite}@keyframes fvx-spin{to{transform:rotate(360deg)}}`;
    document.head.appendChild(s);
    const p = document.createElement('div');
    p.id = 'foxvox-bias-panel';
    p.innerHTML = `<div class="fvx-head"><span class="fvx-title">Claim Checker</span></div><div class="fvx-loading"><div class="fvx-spinner"></div><span>Analyzing article…</span></div>`;
    document.body.appendChild(p);
}

function showErrorPanel(message) {
    const panel = document.getElementById('foxvox-bias-panel');
    const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    if (panel) {
        panel.innerHTML = `<div style="padding:12px 14px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;"><span style="font-size:15px;font-weight:700;color:#0f172a;">Claim Checker</span><button id="fvx-err-close" style="background:none;border:none;cursor:pointer;font-size:16px;color:#94a3b8;padding:2px 6px;">✕</button></div><div style="padding:16px;"><div style="background:#fee2e2;color:#dc2626;border-radius:8px;padding:14px;font-size:13px;line-height:1.6;"><strong>Analysis failed</strong><br>${esc(message)}</div></div>`;
        document.getElementById('fvx-err-close')?.addEventListener('click', () => { panel.remove(); document.getElementById('foxvox-bias-style')?.remove(); });
    }
}

function showResultsPanel(results, analysisType, newsItems, pageTitle) {
    document.getElementById('foxvox-bias-panel')?.remove();
    document.getElementById('foxvox-bias-style')?.remove();

    // ── Utilities ──────────────────────────────────────────────────────────
    const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    function parseJSON(text) {
        if (!text) return null;
        try { return JSON.parse(text); } catch(e) {}
        const m = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (m) { try { return JSON.parse(m[1].trim()); } catch(e) {} }
        const s = text.indexOf('{'), e2 = text.lastIndexOf('}');
        if (s !== -1 && e2 > s) { try { return JSON.parse(text.slice(s, e2+1)); } catch(e) {} }
        return null;
    }

    // ── Verdict / credibility config ───────────────────────────────────────
    const V = {
        'likely true':    ['#16a34a','#dcfce7'],
        'likely false':   ['#dc2626','#fee2e2'],
        'mixed/disputed': ['#d97706','#fef9c3'],
        'mixed':          ['#d97706','#fef9c3'],
        'unverified':     ['#64748b','#f1f5f9'],
        'leans left':     ['#2563eb','#dbeafe'],
        'leans right':    ['#ea580c','#ffedd5'],
        'neutral':        ['#64748b','#f1f5f9'],
    };
    const C = {
        'High':        ['#16a34a','#dcfce7'],
        'Medium':      ['#d97706','#fef9c3'],
        'Low':         ['#dc2626','#fee2e2'],
        'Balanced':    ['#16a34a','#dcfce7'],
        'Slight Lean': ['#d97706','#fef9c3'],
        'Strong Lean': ['#dc2626','#fee2e2'],
    };
    const gv = v => V[(v||'').toLowerCase().trim()] || ['#64748b','#f1f5f9'];
    const gc = c => C[c||''] || ['#64748b','#f1f5f9'];

    // ── Render one provider's structured result ────────────────────────────
    function renderProvider(r, uid) {
        if (r.error) return `<div class="fvx-err">⚠ ${esc(r.error)}</div>`;
        const p = parseJSON(r.analysis);
        if (!p || !Array.isArray(p.claims)) {
            return `<div class="fvx-err">Could not parse structured response.<br><pre>${esc((r.analysis||'').slice(0,400))}</pre></div>`;
        }
        const [cc, cb] = gc(p.credibility);
        let html = `<div class="fvx-sec"><div class="fvx-lbl">Page Summary</div>
            <p class="fvx-summ">${esc(p.summary)}</p>
            <span class="fvx-badge" style="background:${cb};color:${cc};">Overall credibility: ${esc(p.credibility||'—')}</span>
            ${p.credibilityReason ? `<p class="fvx-creason">${esc(p.credibilityReason)}</p>` : ''}
        </div>`;

        (p.claims||[]).forEach((claim, i) => {
            const [vc] = gv(claim.verdict);
            const bodyId = `fvxb-${uid}-${i}`;
            const ddId   = `fvxd-${uid}-${i}`;
            const sup = (claim.supporting||[]).map(s=>`<li>${esc(s)}</li>`).join('');
            const opp = (claim.opposing||[]).map(s=>`<li>${esc(s)}</li>`).join('');
            const news = (newsItems||[]).slice(0,3).filter(n=>n.url).map(n=>
                `<a href="${esc(n.url)}" target="_blank" class="fvx-nlink">
                    <span class="fvx-nlbl">Related</span>
                    <span class="fvx-ntitle">${esc(n.title)}</span>
                    ${n.date?`<span class="fvx-ndate">${esc(n.date)}</span>`:''}
                </a>`).join('');

            html += `<div class="fvx-claim">
                <div class="fvx-ch" data-body="${bodyId}">
                    <span class="fvx-dot" style="background:${vc};"></span>
                    <span class="fvx-ct">${esc(claim.claim)}</span>
                    <span class="fvx-vl" style="color:${vc};">${esc(claim.verdict||'')}</span>
                    <span class="fvx-arr">▸</span>
                </div>
                <div class="fvx-cb" id="${bodyId}">
                    ${sup?`<div class="fvx-lbl" style="margin-top:10px;">Supporting Evidence</div><ul class="fvx-ul grn">${sup}</ul>`:''}
                    ${opp?`<div class="fvx-lbl">Opposing Evidence</div><ul class="fvx-ul red">${opp}</ul>`:''}
                    ${claim.assessment?`<div class="fvx-lbl">Assessment</div><p class="fvx-ap">${esc(claim.assessment)}</p>`:''}
                    ${news?`<div class="fvx-nsec">${news}</div>`:''}
                    ${claim.deepDive?`<button class="fvx-ddbtn" data-dd="${ddId}">Deep Dive</button>
                        <div class="fvx-dd" id="${ddId}">
                            <div class="fvx-lbl">Detailed Analysis</div>
                            <p class="fvx-ap">${esc(claim.deepDive)}</p>
                        </div>`:''}
                </div>
            </div>`;
        });
        return html;
    }

    // ── CSS ────────────────────────────────────────────────────────────────
    const css = `
#foxvox-bias-panel{position:fixed;top:0;right:0;width:380px;height:100vh;background:#fff;box-shadow:-3px 0 20px rgba(0,0,0,0.12);z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#1e293b;display:flex;flex-direction:column;animation:fvx-in .25s ease}
@keyframes fvx-in{from{transform:translateX(380px)}to{transform:translateX(0)}}
.fvx-head{padding:12px 14px;border-bottom:1px solid #e2e8f0;display:flex;align-items:flex-start;justify-content:space-between;flex-shrink:0}
.fvx-hl{display:flex;flex-direction:column}
.fvx-title{font-size:15px;font-weight:700;color:#0f172a}
.fvx-art{font-size:11px;color:#64748b;margin-top:2px;max-width:300px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fvx-close{background:none;border:none;cursor:pointer;font-size:16px;color:#94a3b8;padding:2px 6px;border-radius:4px;line-height:1;font-family:inherit}
.fvx-close:hover{background:#f1f5f9;color:#1e293b}
.fvx-tabs{display:flex;gap:4px;padding:8px 12px;border-bottom:1px solid #e2e8f0;overflow-x:auto;flex-shrink:0}
.fvx-tab{display:flex;align-items:center;gap:5px;padding:4px 10px;border-radius:20px;border:1px solid #e2e8f0;background:#f8fafc;cursor:pointer;font-size:11px;font-weight:600;color:#64748b;white-space:nowrap;font-family:inherit}
.fvx-tab.on{background:#0f172a;color:#fff;border-color:#0f172a}
.fvx-tdot{width:8px;height:8px;border-radius:50%;display:inline-block;flex-shrink:0}
.fvx-body{flex:1;overflow-y:auto}
.fvx-pane{display:none}.fvx-pane.on{display:block}
.fvx-sec{padding:14px;border-bottom:1px solid #f1f5f9}
.fvx-lbl{font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:6px}
.fvx-summ{font-size:13px;line-height:1.6;color:#374151;margin:0 0 10px}
.fvx-badge{display:inline-block;font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px}
.fvx-creason{font-size:11px;color:#64748b;margin:6px 0 0;font-style:italic}
.fvx-claim{border-bottom:1px solid #f1f5f9}
.fvx-ch{display:flex;align-items:flex-start;gap:9px;padding:11px 14px;cursor:pointer}
.fvx-ch:hover{background:#f8fafc}
.fvx-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;margin-top:3px}
.fvx-ct{flex:1;font-size:13px;font-weight:500;line-height:1.4}
.fvx-vl{font-size:11px;font-weight:600;white-space:nowrap;margin-top:2px;flex-shrink:0}
.fvx-arr{font-size:10px;color:#cbd5e1;flex-shrink:0;margin-top:3px;transition:transform .15s;display:inline-block}
.fvx-arr.open{transform:rotate(90deg)}
.fvx-cb{display:none;padding:0 14px 14px}
.fvx-cb.open{display:block}
.fvx-ul{margin:0 0 8px;padding:0;list-style:none}
.fvx-ul li{font-size:12px;color:#475569;line-height:1.5;padding:2px 0 2px 14px;position:relative}
.fvx-ul.grn li::before{content:'●';color:#22c55e;position:absolute;left:0;font-size:7px;top:6px}
.fvx-ul.red li::before{content:'●';color:#ef4444;position:absolute;left:0;font-size:7px;top:6px}
.fvx-ap{font-size:12px;color:#374151;line-height:1.6;margin:4px 0 8px}
.fvx-nsec{margin-top:8px;border-top:1px solid #f1f5f9;padding-top:4px}
.fvx-nlink{display:flex;flex-direction:column;gap:1px;padding:5px 0;text-decoration:none;border-top:1px solid #f8fafc}
.fvx-nlbl{font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8}
.fvx-ntitle{font-size:12px;color:#2563eb;line-height:1.4}
.fvx-ntitle:hover{text-decoration:underline}
.fvx-ndate{font-size:10px;color:#94a3b8}
.fvx-ddbtn{display:inline-block;margin-top:8px;padding:4px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:20px;cursor:pointer;font-size:12px;font-weight:600;color:#475569;font-family:inherit}
.fvx-ddbtn:hover{background:#e2e8f0}
.fvx-dd{display:none;margin-top:8px;padding:10px;background:#f8fafc;border-radius:8px}
.fvx-dd.open{display:block}
.fvx-err{margin:12px;padding:12px;background:#fee2e2;color:#dc2626;border-radius:8px;font-size:12px}
.fvx-err pre{margin:6px 0 0;font-size:10px;white-space:pre-wrap;color:#7f1d1d}`;

    // ── Build & mount ──────────────────────────────────────────────────────
    const uid = Date.now();
    const multi = results.length > 1;
    const TLABELS = { factcheck:'Fact Check', political:'Political Analysis', summary:'Summary' };

    const tabsHtml = multi
        ? `<div class="fvx-tabs">${results.map((r,i)=>`<button class="fvx-tab${i===0?' on':''}" data-i="${i}"><span class="fvx-tdot" style="background:${r.color};"></span>${r.name.split(' ')[0]}</button>`).join('')}</div>`
        : '';
    const panesHtml = results.map((r,i)=>
        `<div class="fvx-pane${i===0?' on':''}" data-i="${i}">${renderProvider(r, uid+i)}</div>`
    ).join('');

    const styleEl = document.createElement('style');
    styleEl.id = 'foxvox-bias-style';
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    const panel = document.createElement('div');
    panel.id = 'foxvox-bias-panel';
    panel.innerHTML = `
        <div class="fvx-head">
            <div class="fvx-hl">
                <span class="fvx-title">Claim Checker</span>
                <span class="fvx-art">${esc(pageTitle||TLABELS[analysisType]||'')}</span>
            </div>
            <button class="fvx-close">✕</button>
        </div>
        ${tabsHtml}
        <div class="fvx-body">${panesHtml}</div>`;
    document.body.appendChild(panel);

    // ── Events ─────────────────────────────────────────────────────────────
    panel.querySelector('.fvx-close').addEventListener('click', () => { panel.remove(); styleEl.remove(); });

    if (multi) {
        panel.querySelectorAll('.fvx-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                panel.querySelectorAll('.fvx-tab').forEach(t => t.classList.remove('on'));
                panel.querySelectorAll('.fvx-pane').forEach(p => p.classList.remove('on'));
                tab.classList.add('on');
                panel.querySelector(`.fvx-pane[data-i="${tab.dataset.i}"]`).classList.add('on');
            });
        });
    }

    panel.querySelectorAll('.fvx-ch').forEach(h => {
        h.addEventListener('click', () => {
            const body = document.getElementById(h.dataset.body);
            const arr  = h.querySelector('.fvx-arr');
            body?.classList.toggle('open');
            arr?.classList.toggle('open');
        });
    });

    panel.querySelectorAll('.fvx-ddbtn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            document.getElementById(btn.dataset.dd)?.classList.toggle('open');
        });
    });
}

/*
--###--
Bias check request handler
--###--
*/

// Fetch current news headlines from Google News RSS
// Returns { contextText: string|null, items: [{title,url,source,date}] }
async function fetchNewsContext(query) {
    try {
        const q = encodeURIComponent(query.trim().slice(0, 120));
        const res = await fetch(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`);
        if (!res.ok) return { contextText: null, items: [] };
        const xml = await res.text();

        const items = [];
        const itemRx = /<item>([\s\S]*?)<\/item>/g;
        let m;
        while ((m = itemRx.exec(xml)) !== null && items.length < 8) {
            const block = m[1];
            const titleMatch  = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
            const linkMatch   = block.match(/<link>([\s\S]*?)<\/link>/);
            const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/);
            const dateMatch   = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
            const title = (titleMatch?.[1]||'').trim().replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
            if (!title) continue;
            const url    = (linkMatch?.[1]||'').trim();
            const source = (sourceMatch?.[1]||'').trim();
            const date   = dateMatch?.[1] ? new Date(dateMatch[1]).toLocaleDateString() : '';
            items.push({ title, url, source, date });
        }

        if (!items.length) return { contextText: null, items: [] };
        const contextText = `=== CURRENT NEWS CONTEXT (${new Date().toLocaleDateString()}) ===\n` +
            items.map(i => `• ${i.title}${i.source ? ` [${i.source}]` : ''}${i.date ? ` (${i.date})` : ''}`).join('\n') +
            `\n=== END NEWS CONTEXT ===\n\n`;
        return { contextText, items };
    } catch (e) {
        console.warn('[FoxVox] News context fetch failed:', e);
        return { contextText: null, items: [] };
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
    let newsContext = null;
    let newsItems = [];
    if (request.webContext && pageTitle) {
        console.log('[FoxVox] Fetching news context for:', pageTitle);
        const fetched = await fetchNewsContext(pageTitle);
        newsContext = fetched.contextText;
        newsItems = fetched.items;
        if (newsContext) console.log('[FoxVox] News context OK:', newsItems.length, 'items');
    }

    // 2. Show loading panel on the page
    await chrome.scripting.executeScript({
        target: { tabId: request.id },
        func: showLoadingPanel
    });

    // 3. Load API keys — promisified so the async chain stays unbroken and the
    //    service worker knows work is still in progress (callback pattern breaks this)
    const storageKeys = [
        'key_openai', 'key_anthropic', 'key_gemini', 'key_grok',
        'key_ollama-url', 'key_ollama-model', 'key_lmstudio-url', 'key_lmstudio-model'
    ];
    const stored = await new Promise(resolve => chrome.storage.local.get(storageKeys, resolve));

    const apiKeys = {
        openai:         stored.key_openai,
        anthropic:      stored.key_anthropic,
        gemini:         stored.key_gemini,
        grok:           stored.key_grok,
        ollama_url:     stored['key_ollama-url'],
        ollama_model:   stored['key_ollama-model'],
        lmstudio_url:   stored['key_lmstudio-url'],
        lmstudio_model: stored['key_lmstudio-model']
    };
    console.log('[FoxVox] Providers:', request.selectedProviders,
        '| lmstudio:', apiKeys.lmstudio_url, apiKeys.lmstudio_model);

    // Heartbeat: keeps service worker alive during slow local model inference
    const keepAlive = setInterval(() => chrome.storage.local.get('_ka', () => {}), 20000);

    try {
        const results = await runBiasAnalysis(
            request.selectedProviders,
            apiKeys,
            request.analysisType,
            pageText,
            newsContext || null
        );
        console.log('[FoxVox] Analysis complete, rendering panel');

        await chrome.scripting.executeScript({
            target: { tabId: request.id },
            func: showResultsPanel,
            args: [results, request.analysisType, newsItems || [], pageTitle || '']
        });

        chrome.runtime.sendMessage({ action: 'bias_check_completed' });
    } catch (e) {
        console.error('[FoxVox] Bias analysis failed:', e);
        chrome.scripting.executeScript({
            target: { tabId: request.id },
            func: showErrorPanel,
            args: [e.message || 'Unknown error']
        });
        chrome.runtime.sendMessage({ action: 'bias_check_error', message: e.message });
    } finally {
        clearInterval(keepAlive);
    }
}

chrome.runtime.onMessage.addListener(async function (request, sender, sendResponse) {
    if (request.action === 'run_bias_check') {
        await handle_bias_check(request);
        return true;
    }
    await process_request(request, sender, sendResponse);
    return true;
});