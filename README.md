# FoxVox Extended

Public fork of [Palisade Research's FoxVox](https://github.com/PalisadeResearch/foxvox) at [`Ryfter/foxvox-AE`](https://github.com/Ryfter/foxvox-AE). Manifest V3, version **4.0**.

**Current status (2026-09-12, v4.1):** Default model is **LM Studio** (local, no key). Optional **Sign in with SuperGrok** and **Sign in with Codex** (device-code; tokens stay in the browser). Pasted cloud keys still work. Bias check defaults to LM Studio. There is no GitHub issue board yet.

Harness for agents: Grimdex `projects/foxvox-ae/` (rules) · Grimlore `projects/foxvox-ae/` (why/who) · Baton project id `foxvox-ae`.

The original demo copy follows. Prefer the Settings tab over any community key.

---

# FoxVox: One Click to Alter Reality

FoxVox is an open-source Chrome extension powered by GPT-4o. It demonstrates how AI can be used to subtly manipulate the content you consume. It can manipulate how we see political figures, view controversial policies, and even slant entire news websites to reflect different biases.

## Table of Contents
- [Installation](#installation)
- [Usage](#usage)
- [Technical Summary](#technical-summary)
- [Potential Improvements](#potential-improvements)

![image](https://github.com/PalisadeResearch/foxvox/assets/167763910/803448a8-d928-4c21-9613-a5f885f4266f)

## Installation From Source

1. Clone the repository:

```bash
git clone https://github.com/Ryfter/foxvox-AE.git
cd foxvox-AE
```

2. Install dependencies:

```bash
npm install
```

3. Build the project:

```bash
npm run build
```

4. Load the extension in Chrome:
    - Open Chrome and navigate to `chrome://extensions/`
    - Enable "Developer mode"
    - Click "Load unpacked" and select this repository directory (the folder that contains `manifest.json`)

## Usage

1. Open the extension popup → **Settings**. Save your own cloud API keys, or point Ollama / LM Studio at a local model and use **Test connection**.
2. Visit a news page. **Rewrite** applies an agenda template. **Bias Check** injects a side-by-side analysis panel on the page.

## Technical Summary

### Overview

FoxVox is built using JavaScript, HTML, and CSS. It leverages the GPT-4o model to dynamically manipulate web content.

### Key Files and Directories

- **background.js**: 
    - Listens for tab updates and sends requests to the GPT-4o API to manipulate content.
    - Handles API responses and updates the web page content accordingly.
    - Manages communication between the content scripts and the GPT-4o API.

- **popup.js**: 
    - Provides a user interface for the extension.
    - Allows users to input their OpenAI API key and configure settings.
    - Communicates with `background.js` to store and retrieve settings.

- **generation.js**: 
    - Contains functions to generate manipulated content.
    - Uses the GPT-4 API to process and alter the text on web pages.
    - Handles the logic for sending content to the API and processing the response.

- **database.js**: 
    - Manages local storage for caching manipulated content.
    - Ensures that repeated requests for the same content are minimized.

- **manifest.json**: 
    - Specifies the extension's permissions, such as access to web pages and storage.
    - Defines the background scripts and popup interface.

### Workflow

1. **Initialization**: 
    - When the extension is loaded, `background.js` initializes and sets up listeners for tab updates.
    - `popup.js` initializes the user interface and retrieves stored settings.

2. **Content Fetching and Manipulation**: 
    - When a user navigates to a new page, `background.js` captures the content tree via an injected script.
    - An algorithm finds optimal chunks to divide the content tree into that find optimum between minimising html code and maximising visible text while retaining the text size large enough for the model to be able to grasp context and do good generation.
    - The content is sent to `generation.js`, which processes it and sends a request to the GPT-4o API.
    - The API response is received and processed by `generation.js`, which then updates the web page content.

3. **Communication Between Background and Popup**: 
    - `popup.js` allows users to input their OpenAI API key and other settings.
    - These settings are sent to `background.js` for storage and use in API requests.
    - `background.js` and `popup.js` communicate via Chrome's messaging API, with the state divided between them.

4. **Content Generation**: 
    - `generation.js` handles the logic for sending content to the GPT-4o API.
    - It constructs the API request, sends the content, and processes the response. We use two requests per chunk of text, one for initial generation and one for improvement and polish.
    - The manipulated content is then injected back into the web page using the associated xpaths.

5. **Caching**: 
    - `database.js` manages local storage to cache manipulated content.
    - This reduces the number of API requests by storing previously manipulated content and reusing it when possible.

## Potential Improvements to this Project

- [ ] Make a **stateless popup** and assert UI from background. This will fix persistancy of the UI and leverage issues from the popup data being lost on closing it.
- [x] **BYO keys + local models** so the demo runs without a shared community key (foxvox-ae-d001). Dedicated server / Google-or-phone auth is not the current path.
- [ ] Improve generation through **better prompting**, advanced **generation techniques** like CoT, RAG, ToT etc and better **context utilisation** -- including clustering of the text chunks that utilises semantic similarity and spatial locality. (Rewrite already does a two-pass refine; bias check is single-pass.)
- [x] **Multi-provider rewrite and bias check** (OpenAI, Anthropic, Gemini, Grok, Ollama, LM Studio) — foxvox-ae-d002, foxvox-ae-d003.
