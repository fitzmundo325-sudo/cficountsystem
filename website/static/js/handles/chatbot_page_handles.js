let chatLog = document.getElementById('chat-log');
let chatEmpty = document.getElementById('chat-empty');
let chatForm = document.getElementById('chat-form');
let chatInput = document.getElementById('chat-input');
let chatSendBtn = document.getElementById('chat-send-btn');
let chatClearBtn = document.getElementById('chat-clear-btn');
let chatModelWrap = document.getElementById('chat-model-wrap');
let chatModelSelect = document.getElementById('chat-model-select');
let chatUserTemplate = document.getElementById('chatUserMessageTemplate');
let chatBotTemplate = document.getElementById('chatBotMessageTemplate');
let chatToolTemplate = document.getElementById('chatToolTemplate');

let chatHistory = [];
let chatController = null;
let chatStreaming = false;
let chatModelList = [];
let chatDefaultModel = '';
let chatPendingRender = null;
let chatPurifyConfig = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['img', 'style', 'form', 'input', 'button', 'textarea', 'select'],
  FORBID_ATTR: ['style']
};

// - Helpers -

function notifyError(message) {
  if (typeof toast !== 'undefined' && toast.error) {
    toast.error(message);
  } else {
    console.error(message);
  }
}

function applyStoreName() {
  if (!initialStoreName) {
    return;
  }
  document.getElementById('headerStoreName').textContent = initialStoreName;
  document.getElementById('pageStoreName').textContent = initialStoreName;
  document.getElementById('pageStoreNameWrap').classList.remove('hidden');
}

function hasModel(id) {
  for (let model of chatModelList) {
    if (model.id === id) {
      return true;
    }
  }
  return false;
}

function getSavedModel() {
  try {
    return localStorage.getItem('chatSelectedModel') || '';
  } catch (error) {
    return '';
  }
}

function saveModel(id) {
  try {
    localStorage.setItem('chatSelectedModel', id);
  } catch (error) {
    return;
  }
}

function populateModels() {
  chatModelSelect.innerHTML = '';
  if (chatModelList.length === 0) {
    chatModelWrap.classList.add('hidden');
    return;
  }
  for (let model of chatModelList) {
    let option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.label || model.id;
    chatModelSelect.appendChild(option);
  }
  let saved = getSavedModel();
  if (saved && hasModel(saved)) {
    chatModelSelect.value = saved;
  } else if (chatDefaultModel && hasModel(chatDefaultModel)) {
    chatModelSelect.value = chatDefaultModel;
  }
  chatModelWrap.classList.remove('hidden');
}

async function loadModels() {
  try {
    let res = await fetch(chatModelsEndpoint);
    let data = await res.json();
    if (data.type !== 'success') {
      throw new Error(data.message || 'Could not load the model list.');
    }
    chatModelList = data.models || [];
    chatDefaultModel = data.default || '';
  } catch (error) {
    chatModelList = [];
    notifyError(error.message);
  }
  populateModels();
}



async function loadChatStats() {
  try {
    let res = await fetch(chatStatsEndpoint);
    let data = await res.json();
    if (data.type !== 'success') {
      throw new Error(data.message || 'Could not load stats.');
    }
	
	populateStats(data);
	
  } catch (error) {
    notifyError(error.message);
  }
  
  function populateStats(data){
	_("chat_limit").innerText = data.remaining+"/"+data.limit;
	_("chat_limit").title = "Messages Remaining, RESETS at: \n"+ utility.formatDate(data.resets_at,false,true);
	
  };
}



function getSelectedModel() {
  return chatModelList.length ? chatModelSelect.value : '';
}

function handleModelChange() {
  saveModel(chatModelSelect.value);
}

function autoResizeInput() {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + 'px';
}

function isNearBottom() {
  return chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 80;
}

function scrollToBottom() {
  chatLog.scrollTop = chatLog.scrollHeight;
}

function appendMessage(role, text) {
  let template = role === 'user' ? chatUserTemplate : chatBotTemplate;
  let row = template.content.firstElementChild.cloneNode(true);
  let bubble = row.querySelector('[data-cell="bubble"]');
  bubble.textContent = text;
  chatEmpty.classList.add('hidden');
  chatLog.appendChild(row);
  scrollToBottom();
  return row;
}

function setStreaming(state) {
  chatStreaming = state;
  chatSendBtn.textContent = state ? 'Stop' : 'Send';
  chatSendBtn.setAttribute('data-state', state ? 'stop' : 'send');
  chatModelSelect.disabled = state;
}

function revealBubble(bubble) {
  bubble.classList.remove('hidden', 'chat-thinking');
}

function finishThinking(parts, startedAt) {
  if (parts.details.classList.contains('hidden') || parts.details.dataset.done === '1') {
    return;
  }
  parts.details.dataset.done = '1';
  parts.details.open = false;
  parts.label.classList.remove('chat-thinking-pulse');
  let seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  parts.label.textContent = 'Thought for ' + seconds + 's';
}

// - Markdown -

function handleSanitizedAttributes(node) {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
}

function getCodeLanguage(code) {
  let match = /language-([\w+-]+)/.exec(code.className);
  return match ? match[1] : '';
}

function buildCodeBlock(pre, lang) {
  let wrapper = document.createElement('div');
  wrapper.className = 'chat-code';

  let header = document.createElement('div');
  header.className = 'chat-code-header';

  let label = document.createElement('span');
  label.className = 'chat-code-lang';
  label.textContent = lang || 'code';

  let button = document.createElement('button');
  button.type = 'button';
  button.className = 'chat-copy-btn';
  button.textContent = 'Copy';

  header.appendChild(label);
  header.appendChild(button);
  pre.parentNode.insertBefore(wrapper, pre);
  wrapper.appendChild(header);
  wrapper.appendChild(pre);
}

function enhanceCodeBlocks(container, highlight) {
  let blocks = container.querySelectorAll('pre > code');
  for (let code of blocks) {
    let lang = getCodeLanguage(code);
    if (highlight && lang && typeof hljs !== 'undefined' && hljs.getLanguage(lang)) {
      hljs.highlightElement(code);
    }
    buildCodeBlock(code.parentElement, lang);
  }
}

function renderMarkdown(bubble, text, final) {
  if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
    bubble.classList.add('whitespace-pre-wrap');
    bubble.textContent = text;
    return;
  }
  let html = marked.parse(text, { gfm: true, breaks: true });
  bubble.innerHTML = DOMPurify.sanitize(html, chatPurifyConfig);
  enhanceCodeBlocks(bubble, final);
}

function flushRender() {
  let job = chatPendingRender;
  chatPendingRender = null;
  if (!job) {
    return;
  }
  let stick = isNearBottom();
  renderMarkdown(job.bubble, job.text, false);
  if (stick) {
    scrollToBottom();
  }
}

function scheduleRender(bubble, text) {
  let wasIdle = chatPendingRender === null;
  chatPendingRender = { bubble: bubble, text: text };
  if (wasIdle) {
    requestAnimationFrame(flushRender);
  }
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  let area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let ok = document.execCommand('copy');
  area.remove();
  if (!ok) {
    throw new Error('Copy failed');
  }
}

function restoreCopyLabel(button) {
  button.textContent = 'Copy';
}


async function handleChatLogClick(event) {
  let fsBtn = event.target.closest('.chat-chart-fs-btn');
  if (fsBtn) {
    toggleChartFullscreen(fsBtn.closest('.chat-chart-card'));
    return;
  }

  let button = event.target.closest('.chat-copy-btn');
  if (!button) {
    return;
  }
  let code = button.closest('.chat-code').querySelector('code');
  try {
    await copyText(code.textContent);
    button.textContent = 'Copied';
    setTimeout(restoreCopyLabel, 1500, button);
  } catch (error) {
    notifyError('Could not copy the code.');
  }
}



function initMarkdown() {
  if (typeof DOMPurify !== 'undefined') {
    DOMPurify.addHook('afterSanitizeAttributes', handleSanitizedAttributes);
  }
}

// - Tools -

function addToolChip(container, chips, info) {
  let chip = chatToolTemplate.content.firstElementChild.cloneNode(true);
  chip.querySelector('[data-cell="icon"]').textContent = '\u2026';
  chip.querySelector('[data-cell="label"]').textContent = info.label || info.name;
  chip.classList.add('chat-thinking-pulse');
  container.classList.remove('hidden');
  container.classList.add('flex');
  container.appendChild(chip);
  chips[info.id] = chip;
}

function finishToolChip(chips, info) {
  let chip = chips[info.id];
  if (!chip) {
    return;
  }
  chip.classList.remove('chat-thinking-pulse');
  chip.querySelector('[data-cell="icon"]').textContent = info.ok ? '\u2713' : '!';
  if (!info.ok) {
    chip.classList.add('chat-tool-failed');
  }
}

// - Streaming -

async function readErrorMessage(res) {
  try {
    let data = await res.json();
    return data.error || data.message || ('Request failed (' + res.status + ')');
  } catch (error) {
    return 'Request failed (' + res.status + ')';
  }
}

function parseEvent(raw) {
  let line = raw.trim();
  if (line.indexOf('data:') !== 0) {
    return null;
  }
  try {
    return JSON.parse(line.slice(5).trim());
  } catch (error) {
    return null;
  }
}

async function sendMessage(text) {
  chatHistory.push({ role: 'user', content: text });
  appendMessage('user', text);

  let row = appendMessage('bot', 'Thinking...');
  let bot = row.querySelector('[data-cell="bubble"]');
  let thinking = {
    details: row.querySelector('[data-cell="thinking"]'),
    label: row.querySelector('[data-cell="thinking-label"]'),
    text: row.querySelector('[data-cell="thinking-text"]')
  };
  let toolBox = row.querySelector('[data-cell="tools"]');
  let chartBox = row.querySelector('[data-cell="charts"]');
  
  let toolChips = {};
  bot.classList.add('chat-thinking');

  let reply = '';
  let thought = '';
  let gotFirst = false;
  let thinkingShown = false;
  let failed = false;
  let startedAt = Date.now();
  chatController = new AbortController();
  setStreaming(true);

  try {
    let res = await fetch(chatEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: chatHistory, model: getSelectedModel() }),
      signal: chatController.signal
    });

    if (!res.ok) {
      throw new Error(await readErrorMessage(res));
    }

    let contentType = res.headers.get('Content-Type') || '';
    if (contentType.indexOf('text/event-stream') === -1) {
      throw new Error('Unexpected response from the server. Please refresh and sign in again.');
    }

    let reader = res.body.getReader();
    let decoder = new TextDecoder();
    let buffer = '';
    let finished = false;

    while (!finished) {
      let result = await reader.read();
      if (result.done) {
        break;
      }

      buffer += decoder.decode(result.value, { stream: true });
      let events = buffer.split('\n\n');
      buffer = events.pop();

      for (let raw of events) {
        let payload = parseEvent(raw);
        if (!payload) {
          continue;
        }
        if (payload.error) {
          throw new Error(payload.error);
        }
        if (payload.tool) {
          let stickTool = isNearBottom();
          addToolChip(toolBox, toolChips, payload.tool);
          if (stickTool) {
            scrollToBottom();
          }
        }
        if (payload.tool_done) {
          finishToolChip(toolChips, payload.tool_done);
        }
		
		if (payload.chart) {
          let stickChart = isNearBottom();
          renderChatChart(chartBox, payload.chart);
          if (stickChart) {
            scrollToBottom();
          }
        }
		
        if (payload.reasoning) {
          if (!thinkingShown) {
            thinkingShown = true;
            bot.classList.add('hidden');
            thinking.details.classList.remove('hidden');
            thinking.details.open = true;
            thinking.label.classList.add('chat-thinking-pulse');
          }
          let stickThought = isNearBottom();
          thought += payload.reasoning;
          thinking.text.textContent = thought;
          thinking.text.scrollTop = thinking.text.scrollHeight;
          if (stickThought) {
            scrollToBottom();
          }
        }
        if (payload.delta) {
          if (!gotFirst) {
            gotFirst = true;
            revealBubble(bot);
            bot.classList.add('chat-streaming', 'chat-md');
            bot.textContent = '';
            finishThinking(thinking, startedAt);
          }
          reply += payload.delta;
          scheduleRender(bot, reply);
        }
        if (payload.done) {
          finished = true;
        }
      }
    }
	if (!reply && (!chartBox || chartBox.children.length === 0)) {
		  revealBubble(bot);
		  bot.textContent = '(no response)';
		} else if (!reply) {
		  bot.classList.add('hidden');
	}
  } catch (error) {
    revealBubble(bot);
    if (error.name === 'AbortError') {
      if (!reply) {
        bot.textContent = '(stopped)';
      }
    } else {
      failed = true;
      bot.classList.add('chat-error');
      bot.textContent = (reply ? reply + '\n\n' : '') + 'Error: ' + error.message;
      notifyError(error.message);
      if (!reply) {
        chatHistory.pop();
        if (!chatInput.value) {
          chatInput.value = text;
          autoResizeInput();
        }
      }
    }
  } finally {
    finishThinking(thinking, startedAt);
    bot.classList.remove('chat-streaming');
    chatPendingRender = null;
    if (reply && !failed) {
      let stick = isNearBottom();
      renderMarkdown(bot, reply, true);
      if (stick) {
        scrollToBottom();
      }
    }
    chatController = null;
    setStreaming(false);
    chatInput.focus();
  }

  if (reply) {
    chatHistory.push({ role: 'assistant', content: reply });
  }
  
  loadChatStats();
  
}

function stopStreaming() {
  if (chatController) {
    chatController.abort();
  }
}

// - Chat actions -

function clearChat() {
  stopStreaming();
  chatHistory = [];
  let rows = chatLog.querySelectorAll('[data-cell="row"]');
  for (let row of rows) {
    row.remove();
  }
  chatEmpty.classList.remove('hidden');
  chatInput.focus();
}

function requestClearChat() {
  if (chatHistory.length === 0) {
    return;
  }
  if (typeof showConfirmationModal === 'function') {
    showConfirmationModal({
      title: 'Clear chat',
      message: 'This will remove the whole conversation.',
      confirmText: 'Clear',
      cancelText: 'Cancel',
      onConfirm: clearChat
    });
  } else if (confirm('Clear the whole conversation?')) {
    clearChat();
  }
}

function handleChatSubmit(event) {
  event.preventDefault();
  if (chatStreaming) {
    stopStreaming();
    return;
  }
  let text = chatInput.value.trim();
  if (!text) {
    return;
  }
  chatInput.value = '';
  autoResizeInput();
  sendMessage(text);
}

function handleChatKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!chatStreaming) {
      chatForm.requestSubmit();
    }
  }
}




function applyNoHeaderMode(override) {
  let hasOverride = typeof override === 'boolean';
  let enable;

  if (hasOverride) {
    enable = override;
  } else {
    let params = new URLSearchParams(window.location.search);
    let val = (params.get('no_header') || '').toLowerCase();
    enable = val === 'true' || val === '1';
  }

  if (!enable && !hasOverride) {
    return;
  }

  let topHeader = document.getElementById('chat-top-header');
  let pageHeader = document.getElementById('chat-page-header');
  let shell = document.getElementById('chatbot-page-shell');
  let card = document.getElementById('chat-card');
  let headless_controls = document.getElementById('headless_controls');

  if (enable) {
    if (topHeader) {
      topHeader.classList.add('hidden');
    }
    if (pageHeader) {
      pageHeader.classList.add('hidden');
    }
    if (headless_controls) {
      headless_controls.classList.remove('hidden');
    }
    if (shell) {
      shell.classList.remove('h-[calc(100dvh-3.5rem)]');
      shell.classList.add('h-dvh');
      shell.classList.add('less_padding');
    }
    if (card && card.style.height) {
      if (!card.dataset.origHeight) {
        card.dataset.origHeight = card.style.height;
      }
      card.style.height = 'calc(100dvh - 3rem)';
    }
  } else {
    if (topHeader) {
      topHeader.classList.remove('hidden');
    }
    if (pageHeader) {
      pageHeader.classList.remove('hidden');
    }
    if (headless_controls) {
      headless_controls.classList.add('hidden');
    }
    if (shell) {
      shell.classList.remove('h-dvh');
      shell.classList.remove('less_padding');
      shell.classList.add('h-[calc(100dvh-3.5rem)]');
    }
    if (card && card.dataset.origHeight) {
      card.style.height = card.dataset.origHeight;
      delete card.dataset.origHeight;
    }
  }
}



//Chart Tools:// Fallback in case getCSSVar is not defined in base_headless.html
if (typeof window.getCSSVar === 'undefined') {
  window.getCSSVar = function (name) {
    let val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return val || '#334155';
  };
}

let chatChartSeq = 0;


function toggleChartFullscreen(card, forceState) {
  if (!card) {
    return;
  }
  let expand = typeof forceState === 'boolean' ? forceState : !card.classList.contains('is-fullscreen');
  card.classList.toggle('is-fullscreen', expand);

  let btn = card.querySelector('.chat-chart-fs-btn');
  if (btn) {
    btn.textContent = expand ? 'Exit Fullscreen (Esc)' : 'Fullscreen';
  }

  let canvas = card.querySelector('canvas');
  if (canvas && typeof chartInstances !== 'undefined' && chartInstances[canvas.id]) {
    chartInstances[canvas.id].resize();
  }
}



function renderChatChart(container, spec) {
  if (!container || !spec) {
    return;
  }
  chatChartSeq += 1;
  let canvasId = 'chat-chart-' + Date.now() + '-' + chatChartSeq;

  let card = document.createElement('div');
  card.className = 'chat-chart-card w-full rounded-xl border border-slate-200 bg-white p-4 shadow-sm';

  let header = document.createElement('div');
  header.className = 'mb-2 flex items-center justify-between gap-2';

  let heading = document.createElement('div');
  heading.className = 'text-xs font-bold uppercase tracking-wide text-slate-600';
  heading.textContent = spec.title || 'Chart';

  let fsBtn = document.createElement('button');
  fsBtn.type = 'button';
  fsBtn.className = 'chat-chart-fs-btn rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100';
  fsBtn.textContent = 'Fullscreen';

  header.appendChild(heading);
  header.appendChild(fsBtn);
  card.appendChild(header);

  let canvasWrap = document.createElement('div');
  canvasWrap.className = 'chat-chart-canvas-wrap relative w-full';
  let canvas = document.createElement('canvas');
  canvas.id = canvasId;
  canvas.style.maxHeight = spec.chart_type === 'pie' ? '300px' : '340px';
  canvasWrap.appendChild(canvas);
  card.appendChild(canvasWrap);

  container.classList.remove('hidden');
  container.classList.add('flex');
  container.appendChild(card);

  let asPct = Boolean(spec.as_percentage);
  let title = spec.title || 'Chart';

  try {
    switch (spec.chart_type) {
      case 'pie':
        generatePieChart(spec.data, canvasId, title, asPct);
        break;
      case 'horizontal_bar':
        generateHorizontalBarChart(
          spec.data,
          canvasId,
          title,
          materialColors,
          !asPct,
          !asPct ? (v) => abbreviateNumber(v).abbreviated : undefined
        );
        break;
      case 'vertical_bar':
        generateVerticalBarChart(spec.data, canvasId, title, asPct);
        break;
      case 'line':
        generateLineChart(spec.data, canvasId, title, asPct);
        break;
      case 'shaded_line':
        generateShadedLineChart(spec.data, canvasId, title, asPct);
        break;
      case 'multi_line':
        generateMultiLineChart(spec.datasets, canvasId, asPct);
        break;
      case 'multi_bar':
        generateMultiBarChart(spec.datasets, canvasId, asPct);
        break;
    }
  } catch (err) {
    console.error('Chart render error:', err);
  }
}


document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape') {
    let activeCard = chatLog.querySelector('.chat-chart-card.is-fullscreen');
    if (activeCard) {
      toggleChartFullscreen(activeCard, false);
    }
  }
});


// Chat Statistics ============================
function getCurrentStats(){
	
	
	
	
}



// Controls and Page Window Management ========

function closeThis(){

	if(chatHistory.length <= 0){
		closeWindow();
		return;
	}

	if (typeof showConfirmationModal === 'function') {
	showConfirmationModal({
	  title: 'Close Chat Window?',
	  message: 'This conversation would be gone as well',
	  confirmText: 'Close',
	  cancelText: 'Cancel',
	  onConfirm: closeWindow
	});
	} else if (confirm('This conversation would be gone as well')) {
	closeWindow();
	}

	function closeWindow(){
		postMessageToParent("close");
	}
}


function minimizeChatG(){
	postMessageToParent("function:minimizeChatG:1");
}


function maximizeChatG(){
	postMessageToParent("function:maximizeChatG:1");	
}



// - Init -

chatForm.addEventListener('submit', handleChatSubmit);
chatInput.addEventListener('keydown', handleChatKeydown);
chatInput.addEventListener('input', autoResizeInput);
chatClearBtn.addEventListener('click', requestClearChat);
chatLog.addEventListener('click', handleChatLogClick);
chatModelSelect.addEventListener('change', handleModelChange);

initMarkdown();
loadModels();
loadChatStats();
applyStoreName();
chatInput.focus();

applyNoHeaderMode();


