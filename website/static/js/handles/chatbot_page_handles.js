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
let chatCard = document.getElementById('chat-card');
let chatSaveBtn = document.getElementById('chat-save-btn');
let chatHistoryBtn = document.getElementById('chat-history-btn');
let chatHistPanel = document.getElementById('chat-history-panel');
let chatHistSearch = document.getElementById('chat-hist-search');
let chatHistList = document.getElementById('chat-hist-list');
let chatHistNew = document.getElementById('chat-hist-new');
let chatHistBack = document.getElementById('chat-hist-back');
let chatHistClearAll = document.getElementById('chat-hist-clear-all');
let chatMenuBtn = document.getElementById('chat-menu-btn');
let chatActions = document.getElementById('chat-actions');
let chatMenuQuery = '(max-width: 849.98px)';

let chatIndexKey = 'chatHistoryIndex';
let chatConvoPrefix = 'chatConvo:';
let chatPageSize = 10;
let chatConvoId = null;
let chatSessionToken = 0;
let chatRenderedStart = 0;
let chatLoadingOlder = false;
let chatOlderLoader = null;
let chatScrollQueued = false;

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
    let href = node.getAttribute('href') || '';
    if (href.startsWith('#')) {
      node.removeAttribute('target');
      node.removeAttribute('rel');
      node.classList.add('chat-chart-link');
    } else {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
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
  let olderBtn = event.target.closest('.chat-older-btn');
  if (olderBtn) {
    chatLoadOlder();
    return;
  }

  let anchorLink = event.target.closest('a[href^="#"]');
  if (anchorLink) {
    let targetId = (anchorLink.getAttribute('href') || '').slice(1);
    let targetCard = targetId ? document.getElementById(targetId) : null;
    if (targetCard) {
      event.preventDefault();
      targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      targetCard.classList.add('ring-2', 'ring-blue-500');
      setTimeout(function () {
        targetCard.classList.remove('ring-2', 'ring-blue-500');
      }, 1600);
    }
    return;
  }

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
  let sessionToken = chatSessionToken;
  let charts = [];
  chatHistory.push({ role: 'user', content: text, ts: Date.now() });
  chatUpdateSaveBtn();
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
      body: JSON.stringify({
        messages: chatHistory.map(function (m) {
          return { role: m.role, content: m.content };
        }),
        model: getSelectedModel()
      }),
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
          charts.push(payload.chart);
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
        if (sessionToken === chatSessionToken) {
          chatHistory.pop();
        }
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
    if (sessionToken === chatSessionToken) {
      chatHistory.push({ role: 'assistant', content: reply, ts: Date.now(), charts: charts });
    }
  }

  if (sessionToken === chatSessionToken) {
    chatPersistConvo();
    chatUpdateSaveBtn();
  }
  
  loadChatStats();
  
}

function stopStreaming() {
  if (chatController) {
    chatController.abort();
  }
}

// - History storage -

function chatNewId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  let bytes = new Uint8Array(16);
  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  let hex = '';
  for (let b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}

function chatStoreGet(key, fallback) {
  try {
    let raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

function chatStoreSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    notifyError('Could not save to this browser. Storage may be full.');
    return false;
  }
}

function chatStoreRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    return;
  }
}

function chatNotifySuccess(message) {
  if (typeof toast !== 'undefined' && toast.success) {
    toast.success(message);
  }
}

function chatReadIndex() {
  let list = chatStoreGet(chatIndexKey, []);
  return Array.isArray(list) ? list : [];
}

function chatWriteIndex(list) {
  return chatStoreSet(chatIndexKey, list);
}

function chatFindEntry(list, id) {
  for (let entry of list) {
    if (entry.id === id) {
      return entry;
    }
  }
  return null;
}

function chatMakeTitle(messages) {
  for (let message of messages) {
    if (message.role === 'user' && message.content) {
      let text = message.content.replace(/\s+/g, ' ').trim();
      return text.length > 60 ? text.slice(0, 57) + '...' : text;
    }
  }
  return 'New conversation';
}

function chatSaveConvo() {
  if (chatHistory.length === 0 || chatConvoId) {
    return;
  }
  let id = chatNewId();
  let now = Date.now();
  if (!chatStoreSet(chatConvoPrefix + id, chatHistory)) {
    return;
  }
  let list = chatReadIndex();
  list.push({ id: id, title: chatMakeTitle(chatHistory), createdAt: now, updatedAt: now, count: chatHistory.length });
  if (!chatWriteIndex(list)) {
    chatStoreRemove(chatConvoPrefix + id);
    return;
  }
  chatConvoId = id;
  chatUpdateSaveBtn();
  chatNotifySuccess('Conversation saved to History.');
}

function chatPersistConvo() {
  if (!chatConvoId) {
    return;
  }
  if (!chatStoreSet(chatConvoPrefix + chatConvoId, chatHistory)) {
    return;
  }
  let list = chatReadIndex();
  let entry = chatFindEntry(list, chatConvoId);
  if (!entry) {
    entry = { id: chatConvoId, title: chatMakeTitle(chatHistory), createdAt: Date.now() };
    list.push(entry);
  }
  entry.updatedAt = Date.now();
  entry.count = chatHistory.length;
  chatWriteIndex(list);
}

function chatRemoveConvo(id) {
  chatStoreRemove(chatConvoPrefix + id);
  let list = chatReadIndex().filter(function (entry) {
    return entry.id !== id;
  });
  chatWriteIndex(list);
  if (id === chatConvoId) {
    chatConvoId = null;
    chatUpdateSaveBtn();
  }
}

function chatRenameConvo(id, title) {
  let clean = title.replace(/\s+/g, ' ').trim();
  if (!clean) {
    return;
  }
  let list = chatReadIndex();
  let entry = chatFindEntry(list, id);
  if (entry) {
    entry.title = clean.slice(0, 120);
    chatWriteIndex(list);
  }
}

function chatUpdateSaveBtn() {
  let saved = Boolean(chatConvoId);
  chatSaveBtn.disabled = saved || chatHistory.length === 0;
  chatSaveBtn.textContent = saved ? 'Saved ✓' : 'Save to History';
  chatSaveBtn.title = saved ? 'Saved. New messages are added automatically.' : 'Save this conversation to History';
}

// - History panel -

function chatCloseMenu() {
  chatActions.classList.remove('is-open');
  chatMenuBtn.setAttribute('aria-expanded', 'false');
}

function chatToggleMenu() {
  let open = !chatActions.classList.contains('is-open');
  chatActions.classList.toggle('is-open', open);
  chatMenuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function chatHandleMenuOutside(event) {
  if (!chatActions.classList.contains('is-open')) {
    return;
  }
  if (event.target.closest('.chat-actions-wrap')) {
    return;
  }
  chatCloseMenu();
}

function chatHandleMenuKey(event) {
  if (event.key === 'Escape' && chatActions.classList.contains('is-open')) {
    chatCloseMenu();
    chatMenuBtn.focus();
  }
}

function chatHandleActionClick(event) {
  if (event.target.closest('button')) {
    chatCloseMenu();
  }
}

function initChatMenu() {
  chatMenuBtn.addEventListener('click', chatToggleMenu);
  chatActions.addEventListener('click', chatHandleActionClick);
  document.addEventListener('click', chatHandleMenuOutside);
  document.addEventListener('keydown', chatHandleMenuKey);
  if (window.matchMedia) {
    let query = window.matchMedia(chatMenuQuery);
    if (query.addEventListener) {
      query.addEventListener('change', chatCloseMenu);
    } else if (query.addListener) {
      query.addListener(chatCloseMenu);
    }
  }
}

function chatSetView(view) {
  chatCloseMenu();
  let isHistory = view === 'history';
  chatCard.setAttribute('data-view', view);
  chatHistPanel.classList.toggle('is-open', isHistory);
  chatLog.classList.toggle('hidden', isHistory);
  chatForm.classList.toggle('hidden', isHistory);
  
  if(isHistory){
	_("notice_banner").classList.remove("hidden");
  }else{
	_("notice_banner").classList.add("hidden");
  }
  
}

function chatDateGroup(ts) {
  let now = new Date();
  let startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  let day = 86400000;
  if (ts >= startToday) {
    return 'Today';
  }
  if (ts >= startToday - day) {
    return 'Yesterday';
  }
  if (ts >= startToday - 7 * day) {
    return 'Previous 7 days';
  }
  if (ts >= startToday - 30 * day) {
    return 'Previous 30 days';
  }
  return 'Older';
}

function chatBuildHistItem(entry) {
  let item = document.createElement('div');
  item.className = 'chat-hist-item' + (entry.id === chatConvoId ? ' is-current' : '');
  item.dataset.id = entry.id;

  let main = document.createElement('div');
  main.className = 'chat-hist-main';

  let title = document.createElement('div');
  title.className = 'chat-hist-title';
  title.textContent = entry.title || 'Untitled';

  let count = entry.count || 0;
  let when = new Date(entry.updatedAt || entry.createdAt || Date.now());
  let meta = document.createElement('div');
  meta.className = 'chat-hist-meta';
  meta.textContent = count + (count === 1 ? ' message' : ' messages') + ' · ' +
    when.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  main.appendChild(title);
  main.appendChild(meta);

  let actions = document.createElement('div');
  actions.className = 'chat-hist-actions';

  let rename = document.createElement('button');
  rename.type = 'button';
  rename.className = 'chat-hist-btn';
  rename.dataset.action = 'rename';
  rename.title = 'Rename';
  rename.innerHTML = '<span class="fa fa-i-cursor"></span>';

  let remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'chat-hist-btn chat-hist-btn-danger';
  remove.dataset.action = 'delete';
  remove.title = 'Delete';
  remove.innerHTML = '<span class="fa fa-trash"></span>';

  actions.appendChild(rename);
  actions.appendChild(remove);
  item.appendChild(main);
  item.appendChild(actions);
  return item;
}



function chatRenderHistList() {
  let query = chatHistSearch.value.trim().toLowerCase();
  let all = chatReadIndex();
  let list = all.slice().sort(function (a, b) {
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
  if (query) {
    list = list.filter(function (entry) {
      return (entry.title || '').toLowerCase().indexOf(query) !== -1;
    });
  }

  chatHistList.innerHTML = '';
  chatHistClearAll.hidden = all.length === 0;

  if (list.length === 0) {
    let empty = document.createElement('div');
    empty.className = 'chat-hist-empty';
    empty.textContent = query ? 'No conversations match your search.' : 'No saved conversations yet. Start chatting, then press Save to History.';
    chatHistList.appendChild(empty);
    return;
  }

  let lastGroup = '';
  for (let entry of list) {
    let group = chatDateGroup(entry.updatedAt || entry.createdAt || 0);
    if (group !== lastGroup) {
      let label = document.createElement('div');
      label.className = 'chat-hist-group';
      label.textContent = group;
      chatHistList.appendChild(label);
      lastGroup = group;
    }
    chatHistList.appendChild(chatBuildHistItem(entry));
  }
}

function chatOpenHistory() {
  chatHistSearch.value = '';
  chatRenderHistList();
  chatHistBack.hidden = chatHistory.length === 0;
  chatSetView('history');
  
}

function chatCloseHistory() {
  chatSetView('chat');
  chatInput.focus();
}

function chatConfirmDiscard(onProceed) {
  if (chatHistory.length === 0 || chatConvoId) {
    onProceed();
    return;
  }
  if (typeof showConfirmationModal === 'function') {
    showConfirmationModal({
      title: 'Discard current chat?',
      message: 'This conversation is not saved to History yet.',
      confirmText: 'Discard',
      cancelText: 'Cancel',
      onConfirm: onProceed
    });
  } else if (confirm('This conversation is not saved to History yet. Discard it?')) {
    onProceed();
  }
}

function chatStartNew() {
  chatConfirmDiscard(function () {
    resetConversation();
    chatSetView('chat');
    chatInput.focus();
  });
}

function chatRequestOpen(id) {
  if (id === chatConvoId) {
    chatCloseHistory();
    return;
  }
  chatConfirmDiscard(function () {
    chatOpenConvo(id);
  });
}

function chatConfirmAction(title, message, confirmText, onConfirm) {
  if (typeof showConfirmationModal === 'function') {
    showConfirmationModal({
      title: title,
      message: message,
      confirmText: confirmText,
      cancelText: 'Cancel',
      onConfirm: onConfirm
    });
  } else if (confirm(message)) {
    onConfirm();
  }
}

function chatRequestDelete(id) {
  chatConfirmAction('Delete conversation', 'This conversation will be removed from History.', 'Delete', function () {
    chatRemoveConvo(id);
    chatRenderHistList();
    chatHistBack.hidden = chatHistory.length === 0;
  });
}

function chatRequestDeleteAll() {
  chatConfirmAction('Delete all history', 'Every saved conversation will be removed from this browser.', 'Delete all', function () {
    for (let entry of chatReadIndex()) {
      chatStoreRemove(chatConvoPrefix + entry.id);
    }
    chatWriteIndex([]);
    chatConvoId = null;
    chatUpdateSaveBtn();
    chatRenderHistList();
    chatHistBack.hidden = chatHistory.length === 0;
  });
}

function chatStartRename(item) {
  let titleEl = item.querySelector('.chat-hist-title');
  if (!titleEl) {
    return;
  }
  let id = item.dataset.id;
  let input = document.createElement('input');
  input.type = 'text';
  input.className = 'chat-hist-rename-input';
  input.maxLength = 120;
  input.value = titleEl.textContent;
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  function finish(save) {
    if (done) {
      return;
    }
    done = true;
    if (save) {
      chatRenameConvo(id, input.value);
    }
    chatRenderHistList();
  }

  input.addEventListener('keydown', function (event) {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      finish(false);
    }
  });
  input.addEventListener('blur', function () {
    finish(true);
  });
}

function chatHandleHistClick(event) {
  if (event.target.closest('.chat-hist-rename-input')) {
    return;
  }
  let item = event.target.closest('.chat-hist-item');
  if (!item) {
    return;
  }
  let actionBtn = event.target.closest('[data-action]');
  if (actionBtn) {
    if (actionBtn.dataset.action === 'rename') {
      chatStartRename(item);
    } else if (actionBtn.dataset.action === 'delete') {
      chatRequestDelete(item.dataset.id);
    }
    return;
  }
  chatRequestOpen(item.dataset.id);
}

// - Loading and lazy rendering -

function resetConversation() {
  stopStreaming();
  chatSessionToken += 1;
  chatHistory = [];
  chatConvoId = null;
  chatRenderedStart = 0;
  chatLoadingOlder = false;
  chatPendingRender = null;
  if (chatOlderLoader) {
    chatOlderLoader.remove();
    chatOlderLoader = null;
  }
  let rows = chatLog.querySelectorAll('[data-cell="row"]');
  for (let row of rows) {
    row.remove();
  }
  chatEmpty.classList.remove('hidden');
  chatUpdateSaveBtn();
}

function chatBuildRow(message) {
  let isUser = message.role === 'user';
  let template = isUser ? chatUserTemplate : chatBotTemplate;
  let row = template.content.firstElementChild.cloneNode(true);
  let bubble = row.querySelector('[data-cell="bubble"]');
  if (isUser) {
    bubble.textContent = message.content;
    return row;
  }
  if (message.content) {
    bubble.classList.add('chat-md');
    renderMarkdown(bubble, message.content, true);
  } else {
    bubble.classList.add('hidden');
  }
  if (Array.isArray(message.charts) && message.charts.length > 0) {
    row.chartSpecs = message.charts;
  }
  return row;
}

function chatMountCharts(rows) {
  for (let row of rows) {
    if (!row.chartSpecs) {
      continue;
    }
    let box = row.querySelector('[data-cell="charts"]');
    for (let spec of row.chartSpecs) {
      renderChatChart(box, spec);
    }
    row.chartSpecs = null;
  }
}

function chatPageStart(end) {
  let start = Math.max(0, end - chatPageSize);
  while (start > 0 && chatHistory[start].role !== 'user') {
    start -= 1;
  }
  return start;
}

function chatUpdateOlderLoader() {
  if (chatRenderedStart > 0) {
    if (!chatOlderLoader) {
      chatOlderLoader = document.createElement('button');
      chatOlderLoader.type = 'button';
      chatOlderLoader.className = 'chat-older-btn';
      chatLog.insertBefore(chatOlderLoader, chatLog.firstChild);
    }
    chatOlderLoader.textContent = 'Load older messages (' + chatRenderedStart + ' more)';
  } else if (chatOlderLoader) {
    chatOlderLoader.remove();
    chatOlderLoader = null;
  }
}

function chatLoadOlder() {
  if (chatRenderedStart <= 0 || chatLoadingOlder) {
    return;
  }
  chatLoadingOlder = true;
  let end = chatRenderedStart;
  let start = chatPageStart(end);
  let anchor = chatLog.querySelector('[data-cell="row"]');
  let prevHeight = chatLog.scrollHeight;
  let prevTop = chatLog.scrollTop;
  let rows = [];

  for (let i = start; i < end; i++) {
    let row = chatBuildRow(chatHistory[i]);
    chatLog.insertBefore(row, anchor);
    rows.push(row);
  }
  chatRenderedStart = start;
  chatMountCharts(rows);
  chatUpdateOlderLoader();
  chatLog.scrollTop = prevTop + (chatLog.scrollHeight - prevHeight);
  chatLoadingOlder = false;
}

function chatRenderInitial() {
  let total = chatHistory.length;
  if (total === 0) {
    return;
  }
  chatEmpty.classList.add('hidden');
  let start = chatPageStart(total);
  chatRenderedStart = start;
  let rows = [];
  for (let i = start; i < total; i++) {
    let row = chatBuildRow(chatHistory[i]);
    chatLog.appendChild(row);
    rows.push(row);
  }
  chatMountCharts(rows);
  chatUpdateOlderLoader();
  scrollToBottom();

  while (chatRenderedStart > 0 && chatLog.scrollHeight <= chatLog.clientHeight + 120) {
    let before = chatRenderedStart;
    chatLoadOlder();
    if (chatRenderedStart === before) {
      break;
    }
  }
  scrollToBottom();
}

function chatOpenConvo(id) {
  let messages = chatStoreGet(chatConvoPrefix + id, null);
  if (!Array.isArray(messages)) {
    notifyError('That conversation could not be loaded.');
    chatRemoveConvo(id);
    chatRenderHistList();
    return;
  }
  resetConversation();
  chatHistory = messages;
  chatConvoId = id;
  chatSetView('chat');
  chatRenderInitial();
  chatUpdateSaveBtn();
  chatInput.focus();
}

function chatHandleScroll() {
  if (chatScrollQueued) {
    return;
  }
  chatScrollQueued = true;
  requestAnimationFrame(function () {
    chatScrollQueued = false;
    if (chatLog.scrollTop < 120) {
      chatLoadOlder();
    }
  });
}

function initChatHistory() {
  chatSaveBtn.addEventListener('click', chatSaveConvo);
  chatHistoryBtn.addEventListener('click', chatOpenHistory);
  chatHistNew.addEventListener('click', chatStartNew);
  chatHistBack.addEventListener('click', chatCloseHistory);
  chatHistClearAll.addEventListener('click', chatRequestDeleteAll);
  chatHistSearch.addEventListener('input', chatRenderHistList);
  chatHistList.addEventListener('click', chatHandleHistClick);
  chatLog.addEventListener('scroll', chatHandleScroll);
  chatUpdateSaveBtn();
  if (chatReadIndex().length > 0) {
    chatOpenHistory();
  }
}

// - Chat actions -

function clearChat() {
  resetConversation();
  chatInput.focus();
}

function requestClearChat() {
  if (chatHistory.length === 0) {
    return;
  }
  if (typeof showConfirmationModal === 'function') {
    showConfirmationModal({
      title: 'Clear chat',
      message: chatConvoId ? 'This clears the chat window. The saved copy stays in History.' : 'This will remove the whole conversation. It is not saved to History yet.',
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
  let canvasId = 'chat-chart-canvas-' + Date.now() + '-' + chatChartSeq;

  let card = document.createElement('div');
  card.id = spec.chart_id || ('chat-chart-' + Date.now() + '-' + chatChartSeq);
  card.className = 'chat-chart-card w-full rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow';

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
	  message: 'Unsaved Chat would be gone as well.',
	  confirmText: 'Close',
	  cancelText: 'Cancel',
	  onConfirm: closeWindow
	});
	} else if (confirm('Unsaved Chat would be gone as well.')) {
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
initChatMenu();
initChatHistory();
loadModels();
loadChatStats();
applyStoreName();
chatInput.focus();

applyNoHeaderMode();


