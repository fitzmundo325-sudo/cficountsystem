let helpCategories = [
  { key: 'all', label: 'All' },
  { key: 'daily', label: 'Daily Work' },
  { key: 'ordering', label: 'Ordering' },
  { key: 'transfers', label: 'Transfers & Wastage' },
  { key: 'records', label: 'Records' }
];

let helpDailyFlow = [
  { id: 'delivery', label: 'Delivery' },
  { id: 'trans-in', label: 'Trans-In / Trans-Out' },
  { id: 'pos-sold', label: 'POS Sold' },
  { id: 'invensync', label: 'InvenSync' },
  { id: 'daily-report', label: 'Daily Report' }
];

let helpTools = [
  {
    id: 'invensync',
    category: 'daily',
    title: 'InvenSync',
    summary: 'Daily stock counts, deliveries, transfers, wastage, and variance.',
    url: '/store-manager/invensync?guide=1',
    steps: [
      'Pick the inventory date at the top, or use the arrows to move one day at a time.',
      'Use Search or the category buttons to find products faster. Click Sync if a product is missing from the list.',
      'Follow each row from Beginning through Delivery, Trans-In, BO, Adv Del, Trans-Out, Wastage, CSI, and Sold.',
      'Hover over Delivery, Trans-In, Trans-Out, or Sold cells to see the records behind the number.',
      'Enter the ending counts, then review Total Ending, Theoretical Ending, and the quantity and peso variance.',
      'If the Motif Breakdown button appears, complete it before saving.',
      'Click Save when everything is checked.'
    ]
  },
  {
    id: 'pos-sold',
    category: 'daily',
    title: 'POS Sold',
    summary: 'Upload the POS file so sold quantities flow into InvenSync.',
    url: '/store-manager/daily-report/pos-sold?guide=1',
    steps: [
      'Choose the report date before scanning or uploading.',
      'Select the POS Sold Excel file and click scan/upload.',
      'Review extracted products, quantities, sales, and discounts.',
      'If Additional Charge for Motif appears, complete the motif breakdown.',
      'Save or proceed so POS quantities reflect in InvenSync Sold.'
    ]
  },
  {
    id: 'delivery',
    category: 'daily',
    title: 'Delivery',
    summary: 'Record received deliveries from the RSO file.',
    url: '/store-manager/delivery?guide=1',
    steps: [
      'Select the correct delivery date.',
      'Upload or scan the RSO file.',
      'Review product names and received quantities.',
      'Use manual add only for products not included in the RSO file.',
      'Click Save so delivery quantities reflect in InvenSync.'
    ]
  },
  {
    id: 'daily-report',
    category: 'daily',
    title: 'Daily Report',
    summary: "Submit the day's sales, spoilage, and discounts to the dashboards.",
    url: '/store-manager/daily-report?guide=1',
    steps: [
      'Confirm the report date in the calendar.',
      'Enter POS sales, CI sales, TC, sales channels, spoilage, and discounts.',
      'Review the values before submitting.',
      'Click Submit Report.',
      'Confirm the send modal so the report is submitted to dashboards.'
    ]
  },
  {
    id: 'oracle',
    category: 'ordering',
    title: 'Oracle',
    summary: 'Check stock, sales averages, and suggested order quantities.',
    url: '/store-manager/oracle?guide=1',
    steps: [
      'Open Oracle and check the selected ordering date.',
      'Review stock, sales average, and suggested order quantities.',
      'Use Daily Averages as a reference only. The cells are not editable.',
      'Review RSO / BO / POS tags when shown.',
      'Submit or export the data when needed.'
    ]
  },
  {
    id: 'transact',
    category: 'transfers',
    title: 'TransAct Form',
    summary: 'Create transfer, wastage, and other transaction records.',
    url: '/store-manager/transaction-activity-form?guide=1',
    steps: [
      'Choose the transaction type and date.',
      'Check the generated control number.',
      'Select the source or destination store and add products.',
      'Review product quantities and remarks.',
      'Save or submit the transaction so it can be tracked.'
    ]
  },
  {
    id: 'trans-in',
    category: 'transfers',
    title: 'Trans-In',
    summary: 'Review and confirm incoming transfers.',
    url: '/store-manager/trans?guide=1',
    steps: [
      'Open Trans-In to view incoming transfers for your store.',
      'Select a pending transfer to review its product list.',
      'Check received quantities and short/over values.',
      'Use the action button to open the transfer details and confirm the received quantities.',
      'Save the review so received stock is reflected properly.'
    ]
  },
  {
    id: 'trans-out',
    category: 'transfers',
    title: 'Trans-Out',
    summary: 'Track transfers sent by your store.',
    url: '/store-manager/trans-out?guide=1',
    steps: [
      'Open Trans-Out to view transfers sent by your store.',
      'Open a transfer record to review product and quantity details.',
      'Check status and remarks for tracking.',
      'Use the action button to see items, quantities, destination, status, and remarks.',
      'Use this page to verify outgoing stock movement.'
    ]
  },
  {
    id: 'wastage',
    category: 'transfers',
    title: 'Wastage',
    summary: 'Verify wastage records and what reaches reporting.',
    url: '/store-manager/wastage?guide=1',
    steps: [
      'Open Wastage to view wastage transfer records.',
      'Select a record to review product quantities and remarks.',
      'Check short/over details if applicable.',
      'Use the information to verify wastage reflected in reporting.'
    ]
  },
  {
    id: 'store-data',
    category: 'records',
    title: 'Store Data',
    summary: 'Look back at submitted reports and InvenSync values.',
    url: '/store-manager/store-data?guide=1',
    steps: [
      'Select month and year to view historical store data.',
      'Review submitted Daily Report values and automated InvenSync values.',
      'Use the table to check sales, spoilage, discounts, and ending inventory.',
      'Export Excel when you need a file copy.'
    ]
  }
];

let helpFaqs = [
  {
    question: "Why can't I edit this date?",
    answer: 'A finalized inventory day is locked and view only. If you need a change on a locked date, please send a ticket through the ticketing system with the store name, date, and what needs to be corrected.'
  },
  {
    question: 'What is the Missing InvenSync Dates window?',
    answer: 'It lists days that were never finalized. Click Go to open the oldest missing date, then complete and save it. Repeat until the list is clear.'
  },
  {
    question: 'A product is not showing in InvenSync.',
    answer: 'Click Sync on the InvenSync page to pull the latest products from the Product Masterlist.'
  },
  {
    question: 'What is the Motif Breakdown button?',
    answer: 'It appears when Additional Charge for Motif is detected. Enter the 2 or 3 products included in each motif charge, then save the breakdown. Net price is computed from unit price, sold quantity, and discount.'
  },
  {
    question: 'A number in InvenSync looks wrong.',
    answer: 'Hover over the Delivery, Trans-In, Trans-Out, or Sold cell to see the records that make up the value. If it still looks wrong, send a ticket with the store, date, tool, and a short description.'
  }
];

let activeHelpCategory = 'all';
let helpSearchTerm = '';
let helpCardElements = [];

function cloneHelpTemplate(templateId) {
  return document.getElementById(templateId).content.firstElementChild.cloneNode(true);
}

function helpCell(root, name) {
  return root.querySelector('[data-cell="' + name + '"]');
}

function setStoreName() {
  if (typeof initialStoreName === 'undefined' || !initialStoreName) return;
  let headerName = document.getElementById('headerStoreName');
  let pageName = document.getElementById('pageStoreName');
  let pageNameWrap = document.getElementById('pageStoreNameWrap');
  if (headerName) headerName.textContent = initialStoreName;
  if (pageName) pageName.textContent = initialStoreName;
  if (pageNameWrap) pageNameWrap.classList.remove('hidden');
}

function renderCategoryButtons() {
  let target = document.getElementById('help-category-target');
  target.innerHTML = '';
  helpCategories.forEach(function (category) {
    let node = cloneHelpTemplate('categoryFilterButtonTemplate');
    let button = helpCell(node, 'button') || node;
    button.textContent = category.label;
    button.dataset.categoryFilter = category.key;
    button.addEventListener('click', function () {
      filterHelpCategory(category.key);
    });
    target.appendChild(node);
  });
  updateCategoryButtons();
}

function updateCategoryButtons() {
  document.querySelectorAll('#help-category-target .category-filter-btn').forEach(function (button) {
    let active = button.dataset.categoryFilter === activeHelpCategory;
    button.classList.toggle('bg-slate-900', active);
    button.classList.toggle('text-white', active);
    button.classList.toggle('bg-white', !active);
    button.classList.toggle('text-slate-700', !active);
  });
}

function renderDailyFlow() {
  let list = document.getElementById('daily-flow-list');
  list.innerHTML = '';
  helpDailyFlow.forEach(function (item, index) {
    let row = cloneHelpTemplate('dailyFlowItemTemplate');
    helpCell(row, 'link').setAttribute('href', '#tool-' + item.id);
    helpCell(row, 'number').textContent = index + 1;
    helpCell(row, 'label').textContent = item.label;
    if (index === helpDailyFlow.length - 1) helpCell(row, 'arrow').remove();
    list.appendChild(row);
  });
}

function renderHelpCards() {
  let grid = document.getElementById('help-grid');
  grid.innerHTML = '';
  helpCardElements = helpTools.map(function (tool) {
    let card = cloneHelpTemplate('helpCardTemplate');
    card.id = 'tool-' + tool.id;
    card.dataset.category = tool.category;
    card.dataset.search = [tool.title, tool.summary].concat(tool.steps).join(' ').toLowerCase();
    helpCell(card, 'title').textContent = tool.title;
    helpCell(card, 'summary').textContent = tool.summary;
    helpCell(card, 'link').setAttribute('href', tool.url);
    let steps = helpCell(card, 'steps');
    tool.steps.forEach(function (text) {
      let step = cloneHelpTemplate('helpStepTemplate');
      step.textContent = text;
      steps.appendChild(step);
    });
    grid.appendChild(card);
    return card;
  });
}

function renderFaqs() {
  let list = document.getElementById('faq-list');
  list.innerHTML = '';
  helpFaqs.forEach(function (faq) {
    let row = cloneHelpTemplate('faqItemTemplate');
    helpCell(row, 'question').textContent = faq.question;
    helpCell(row, 'answer').textContent = faq.answer;
    list.appendChild(row);
  });
}

function applyHelpFilters() {
  let visible = 0;
  helpCardElements.forEach(function (card) {
    let matchesCategory = activeHelpCategory === 'all' || card.dataset.category === activeHelpCategory;
    let matchesSearch = !helpSearchTerm || card.dataset.search.indexOf(helpSearchTerm) !== -1;
    let show = matchesCategory && matchesSearch;
    card.classList.toggle('hidden', !show);
    if (show) visible += 1;
  });
  let filtering = activeHelpCategory !== 'all' || !!helpSearchTerm;
  document.getElementById('help-empty').classList.toggle('hidden', visible !== 0);
  document.getElementById('daily-flow-section').classList.toggle('hidden', filtering);
  document.getElementById('faq-section').classList.toggle('hidden', filtering);
}

function filterHelpCategory(key) {
  activeHelpCategory = key;
  updateCategoryButtons();
  applyHelpFilters();
}

function initHelpPage() {
  setStoreName();
  renderCategoryButtons();
  renderDailyFlow();
  renderHelpCards();
  renderFaqs();
  document.getElementById('help-search-input').addEventListener('input', function (event) {
    helpSearchTerm = event.target.value.trim().toLowerCase();
    applyHelpFilters();
  });
  document.documentElement.style.scrollBehavior = 'smooth';
  applyHelpFilters();
}

initHelpPage();
