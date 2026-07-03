const apiUrlInput = document.getElementById('apiUrl');
const autoAnalyzeInput = document.getElementById('autoAnalyze');
const themeToggle = document.getElementById('themeToggle');
const walletInput = document.getElementById('wallet');
const walletCards = document.getElementById('walletCards');
const walletCount = document.getElementById('walletCount');
const issuerSelect = document.getElementById('issuerSelect');
const cardPresetSelect = document.getElementById('cardPreset');
const cardPreview = document.getElementById('cardPreview');
const cardNameInput = document.getElementById('cardName');
const cardLast4Input = document.getElementById('cardLast4');
const cardNetworkInput = document.getElementById('cardNetwork');
const cardBaseRateInput = document.getElementById('cardBaseRate');
const ruleNameInput = document.getElementById('ruleName');
const ruleCategoryInput = document.getElementById('ruleCategory');
const ruleRateInput = document.getElementById('ruleRate');
const ruleMerchantInput = document.getElementById('ruleMerchant');
const loadExampleButton = document.getElementById('loadExample');
const addPresetButton = document.getElementById('addPreset');
const clearCardFormButton = document.getElementById('clearCardForm');
const addCustomCardButton = document.getElementById('addCustomCard');
const customDetails = document.querySelector('.customDetails');
const saveButton = document.getElementById('save');
const analyzeButton = document.getElementById('analyze');
const message = document.getElementById('message');
const statusDot = document.getElementById('statusDot');
let editingCardIndex = null;

const ISSUER_CATALOG = [
  {
    id: 'chase',
    name: 'Chase',
    tone: 'ruby',
    cards: [
      cardPreset('chase-sapphire-preferred', 'Chase Sapphire Preferred', 'Visa', '9001', 1, [rule('Dining', 3, 'dining'), rule('Travel', 2, 'travel'), rule('Online groceries', 3, 'grocery')]),
      cardPreset('chase-freedom-flex', 'Chase Freedom Flex', 'Mastercard', '4444', 1, [rule('Dining', 3, 'dining'), rule('Drugstores', 3, 'pharmacy')]),
      cardPreset('chase-freedom-unlimited', 'Chase Freedom Unlimited', 'Visa', '4015', 1.5, [rule('Dining', 3, 'dining'), rule('Drugstores', 3, 'pharmacy')]),
      cardPreset('prime-visa', 'Prime Visa', 'Visa', '1001', 1, [merchantRule('Amazon purchases', 5, 'Amazon'), merchantRule('Whole Foods', 5, 'Whole Foods', 'grocery')])
    ]
  },
  {
    id: 'amex',
    name: 'American Express',
    tone: 'crimson',
    cards: [
      cardPreset('amex-gold', 'American Express Gold', 'Amex', '7004', 1, [rule('Dining', 4, 'dining'), rule('Groceries', 4, 'grocery'), rule('Travel', 3, 'travel')]),
      cardPreset('amex-platinum', 'American Express Platinum', 'Amex', '7005', 1, [rule('Travel', 5, 'travel')]),
      cardPreset('amex-blue-cash-preferred', 'Amex Blue Cash Preferred', 'Amex', '6006', 1, [rule('Groceries', 6, 'grocery'), rule('Gas', 3, 'gas'), rule('Streaming/Entertainment', 6, 'entertainment')]),
      cardPreset('amex-blue-cash-everyday', 'Amex Blue Cash Everyday', 'Amex', '5555', 1, [rule('Groceries', 3, 'grocery'), rule('Online retail', 3, 'online_shopping'), rule('Gas', 3, 'gas')])
    ]
  },
  {
    id: 'capital-one',
    name: 'Capital One',
    tone: 'scarlet',
    cards: [
      cardPreset('capital-one-savor', 'Capital One Savor', 'Mastercard', '3001', 1, [rule('Dining', 3, 'dining'), rule('Grocery stores', 3, 'grocery'), rule('Entertainment', 3, 'entertainment')]),
      cardPreset('capital-one-quicksilver', 'Capital One Quicksilver', 'Mastercard', '3002', 1.5, []),
      cardPreset('capital-one-venture', 'Capital One Venture', 'Visa', '3003', 2, [rule('Travel', 2, 'travel')]),
      cardPreset('capital-one-venture-x', 'Capital One Venture X', 'Visa', '3004', 2, [rule('Travel', 2, 'travel')])
    ]
  },
  {
    id: 'citi',
    name: 'Citi',
    tone: 'red',
    cards: [
      cardPreset('citi-double-cash', 'Citi Double Cash', 'Mastercard', '2002', 2, []),
      cardPreset('citi-custom-cash', 'Citi Custom Cash', 'Mastercard', '2005', 1, [rule('Grocery top category', 5, 'grocery'), rule('Gas top category', 5, 'gas'), rule('Dining top category', 5, 'dining')]),
      cardPreset('citi-strata-premier', 'Citi Strata Premier', 'Mastercard', '2010', 1, [rule('Dining', 3, 'dining'), rule('Gas', 3, 'gas'), rule('Groceries', 3, 'grocery'), rule('Travel', 3, 'travel')])
    ]
  },
  {
    id: 'bank-of-america',
    name: 'Bank of America',
    tone: 'ruby',
    cards: [
      cardPreset('bofa-customized-cash', 'Bank of America Customized Cash', 'Visa', '1234', 1, [rule('Online shopping choice category', 3, 'online_shopping'), rule('Grocery stores', 2, 'grocery')]),
      cardPreset('bofa-unlimited-cash', 'Bank of America Unlimited Cash', 'Visa', '1550', 1.5, []),
      cardPreset('bofa-premium-rewards', 'Bank of America Premium Rewards', 'Visa', '1551', 1.5, [rule('Travel', 2, 'travel'), rule('Dining', 2, 'dining')])
    ]
  },
  {
    id: 'wells-fargo',
    name: 'Wells Fargo',
    tone: 'scarlet',
    cards: [
      cardPreset('wells-fargo-active-cash', 'Wells Fargo Active Cash', 'Visa', '8002', 2, []),
      cardPreset('wells-fargo-autograph', 'Wells Fargo Autograph', 'Visa', '8003', 1, [rule('Dining', 3, 'dining'), rule('Gas', 3, 'gas'), rule('Travel', 3, 'travel')])
    ]
  },
  {
    id: 'discover',
    name: 'Discover',
    tone: 'crimson',
    cards: [
      cardPreset('discover-it-cash-back', 'Discover it Cash Back', 'Discover', '6011', 1, [rule('Rotating categories', 5, 'other')]),
      cardPreset('discover-it-miles', 'Discover it Miles', 'Discover', '6012', 1.5, [rule('Travel', 1.5, 'travel')])
    ]
  },
  {
    id: 'apple',
    name: 'Apple',
    tone: 'red',
    cards: [
      cardPreset('apple-card', 'Apple Card', 'Mastercard', '3333', 1, [merchantCategoryRule('Apple Pay', 2, 'apple pay'), merchantRule('Apple purchases', 3, 'Apple')])
    ]
  },
  {
    id: 'everyday',
    name: 'Everyday flat-rate',
    tone: 'scarlet',
    cards: [
      cardPreset('flat-2-percent', 'Flat 2% Card', 'Mastercard', '2222', 2, []),
      cardPreset('flat-1-5-percent', 'Flat 1.5% Card', 'Visa', '1115', 1.5, [])
    ]
  }
];

const CARD_PRESETS = Object.fromEntries(ISSUER_CATALOG.flatMap((issuer) => issuer.cards.map((card) => [card.id, { ...card, issuer: issuer.name, issuerTone: issuer.tone }])));

function cardPreset(id, name, network, last4, basePercent, rewardRules) {
  return { id, name, originalName: name, network, last4, baseRate: percentToDecimal(basePercent), rewardRules };
}

function rule(name, percent, category) {
  return { name, category, rate: percentToDecimal(percent) };
}

function merchantRule(name, percent, merchant, category = '') {
  const value = { name, merchant, rate: percentToDecimal(percent) };
  if (category) value.category = category;
  return value;
}

function merchantCategoryRule(name, percent, merchantCategory) {
  return { name, merchantCategory, rate: percentToDecimal(percent) };
}
initCatalog();
init();

loadExampleButton.addEventListener('click', loadExampleWallet);
issuerSelect.addEventListener('change', populateCardSelect);
cardPresetSelect.addEventListener('change', renderCardPreview);
addPresetButton.addEventListener('click', addSelectedPreset);
clearCardFormButton.addEventListener('click', clearCardForm);
addCustomCardButton.addEventListener('click', addCustomCard);
saveButton.addEventListener('click', saveSettings);
analyzeButton.addEventListener('click', analyzeCheckout);
themeToggle.addEventListener('click', toggleThemeMode);
walletInput.addEventListener('input', renderWalletCards);

function initCatalog() {
  issuerSelect.innerHTML = ISSUER_CATALOG.map((issuer) => `<option value="${issuer.id}">${issuer.name}</option>`).join('');
  populateCardSelect();
}

function populateCardSelect() {
  const issuer = selectedIssuer();
  cardPresetSelect.innerHTML = issuer.cards.map((card) => `<option value="${card.id}">${card.name}</option>`).join('');
  renderCardPreview();
}

function renderCardPreview() {
  const issuer = selectedIssuer();
  const card = CARD_PRESETS[cardPresetSelect.value] || issuer.cards[0];
  if (!card) {
    cardPreview.innerHTML = '';
    return;
  }
  const topRules = Array.isArray(card.rewardRules) && card.rewardRules.length > 0
    ? card.rewardRules.slice(0, 2).map((item) => `${escapeHtml(item.name)} ${decimalToPercent(item.rate)}%`).join(' / ')
    : `${decimalToPercent(card.baseRate)}% flat base`;

  cardPreview.innerHTML = `
    <div class="miniCard ${issuer.tone}">
      <div>
        <div class="miniCardName">${escapeHtml(card.name)}</div>
        <div class="miniCardMeta">${escapeHtml(card.network)} / ${decimalToPercent(card.baseRate)}% base</div>
        <div class="miniCardRules">${topRules}</div>
      </div>
    </div>
  `;
}

function selectedIssuer() {
  return ISSUER_CATALOG.find((issuer) => issuer.id === issuerSelect.value) || ISSUER_CATALOG[0];
}
async function init() {
  const { apiUrl = 'http://localhost:8787', wallet = [], autoAnalyze = true, themeMode = 'dark' } = await chrome.storage.local.get(['apiUrl', 'wallet', 'autoAnalyze', 'themeMode']);
  apiUrlInput.value = apiUrl;
  autoAnalyzeInput.checked = autoAnalyze;
  applyThemeMode(themeMode);
  walletInput.value = JSON.stringify(wallet, null, 2);
  renderWalletCards();
  await checkHealth();
}


async function toggleThemeMode() {
  const nextTheme = document.body.dataset.theme === 'light' ? 'dark' : 'light';
  applyThemeMode(nextTheme);
  await chrome.storage.local.set({ themeMode: nextTheme });
}

function applyThemeMode(themeMode) {
  const normalized = themeMode === 'light' ? 'light' : 'dark';
  document.body.dataset.theme = normalized;
  themeToggle.setAttribute('aria-pressed', String(normalized === 'light'));
  themeToggle.setAttribute('aria-label', normalized === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
}
function loadExampleWallet() {
  walletInput.value = JSON.stringify([
    CARD_PRESETS['prime-visa'],
    CARD_PRESETS['bofa-customized-cash'],
    CARD_PRESETS['flat-2-percent']
  ], null, 2);
  renderWalletCards();
  setMessage('Example wallet loaded. Save to use it.');
}

async function addSelectedPreset() {
  try {
    const wallet = parseWallet();
    const preset = CARD_PRESETS[cardPresetSelect.value];
    if (!preset) throw new Error('Preset not found.');
    if (wallet.some((card) => card.id === preset.id)) {
      setMessage(`${preset.name} is already in your wallet.`);
      return;
    }
    wallet.push(structuredClone(preset));
    walletInput.value = JSON.stringify(wallet, null, 2);
    renderWalletCards();
    await persistWallet(wallet);
    setMessage(`${preset.name} added.`);
  } catch (error) {
    setMessage(error.message, true);
  }
}
async function addCustomCard() {
  try {
    const name = cardNameInput.value.trim();
    if (!name) throw new Error('Custom card needs a name.');

    const wallet = parseWallet();
    const existingCard = editingCardIndex === null ? null : wallet[editingCardIndex];
    const card = buildCardFromForm(existingCard);

    if (editingCardIndex === null) {
      wallet.push(card);
      setMessage(`${name} added.`);
    } else {
      if (!existingCard) throw new Error('That card is no longer in your wallet.');
      wallet[editingCardIndex] = card;
      setMessage(`${name} updated.`);
    }

    walletInput.value = JSON.stringify(wallet, null, 2);
    renderWalletCards();
    clearCardForm();
    await persistWallet(wallet);
  } catch (error) {
    setMessage(error.message, true);
  }
}

function buildCardFromForm(existingCard = null) {
  const name = cardNameInput.value.trim();
  const baseRate = percentToDecimal(cardBaseRateInput.value || '1');
  const ruleRate = ruleRateInput.value ? percentToDecimal(ruleRateInput.value) : null;
  const card = {
    ...(existingCard || {}),
    id: existingCard?.id || slugify(`${name}-${cardLast4Input.value || Date.now()}`),
    name,
    originalName: existingCard?.originalName || existingCard?.name || name,
    network: cardNetworkInput.value.trim() || 'Card',
    last4: cardLast4Input.value.trim() || '',
    baseRate,
    rewardRules: []
  };

  if (ruleRate !== null) {
    const rule = {
      name: ruleNameInput.value.trim() || 'Bonus rewards',
      rate: ruleRate
    };
    if (ruleCategoryInput.value) rule.category = ruleCategoryInput.value;
    if (ruleMerchantInput.value.trim()) rule.merchant = ruleMerchantInput.value.trim();
    card.rewardRules.push(rule);
  }

  return card;
}

function clearCardForm() {
  editingCardIndex = null;
  cardNameInput.value = '';
  cardLast4Input.value = '';
  cardNetworkInput.value = '';
  cardBaseRateInput.value = '';
  ruleNameInput.value = '';
  ruleCategoryInput.value = '';
  ruleRateInput.value = '';
  ruleMerchantInput.value = '';
  addCustomCardButton.textContent = 'Add custom card';
}

function percentToDecimal(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error('Rates must be positive numbers.');
  return Math.round((number / 100) * 10000) / 10000;
}

function slugify(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `card-${Date.now()}`;
}
function renderWalletCards() {
  let wallet;
  try {
    wallet = JSON.parse(walletInput.value || '[]');
  } catch {
    walletCards.innerHTML = '<div class="emptyState">Wallet JSON is invalid.</div>';
    walletCount.textContent = 'error';
    return;
  }

  if (!Array.isArray(wallet) || wallet.length === 0) {
    walletCards.innerHTML = '<div class="emptyState">No cards yet. Add a preset or custom card.</div>';
    walletCount.textContent = '0 cards';
    return;
  }

  walletCount.textContent = `${wallet.length} ${wallet.length === 1 ? 'card' : 'cards'}`;
  walletCards.innerHTML = wallet.map((card, index) => renderWalletCard(card, index)).join('');
  walletCards.querySelectorAll('[data-edit-card]').forEach((button) => {
    button.addEventListener('click', () => editWalletCard(Number(button.dataset.editCard)));
  });
  walletCards.querySelectorAll('[data-remove-card]').forEach((button) => {
    button.addEventListener('click', () => removeWalletCard(Number(button.dataset.removeCard)));
  });
}

function renderWalletCard(card, index) {
  const basePercent = decimalToPercent(card.baseRate || 0);
  const tone = card.issuerTone || 'red';
  const rules = Array.isArray(card.rewardRules) ? card.rewardRules : [];
  const ruleText = rules.length > 0
    ? rules.slice(0, 2).map((rule) => `${escapeHtml(rule.name || 'Bonus')} ${decimalToPercent(rule.rate || 0)}%`).join(' / ')
    : 'No bonus rules';
  const originalText = card.originalName && card.originalName !== card.name ? `<span>Original: ${escapeHtml(card.originalName)}</span>` : '';

  return `
    <article class="walletCard ${escapeHtml(tone)}">
      <div class="walletCardTop">
        <div class="walletIdentity">
          <div class="walletName">${escapeHtml(card.name || 'Unnamed card')}</div>
          <div class="walletMeta">${escapeHtml(card.issuer || card.network || 'Card')}${card.last4 ? ` - ${escapeHtml(card.last4)}` : ''}</div>
        </div>
        <div class="walletActions">
          <button type="button" class="smallEdit" data-edit-card="${index}">Edit</button>
          <button type="button" class="smallDanger" data-remove-card="${index}">Remove</button>
        </div>
      </div>
      <div class="walletRewards">
        <span>${basePercent}% base</span>
        ${originalText}
        <span>${ruleText}</span>
      </div>
    </article>
  `;
}

function editWalletCard(index) {
  try {
    const wallet = parseWallet();
    const card = wallet[index];
    if (!card) throw new Error('Card not found.');
    const firstRule = Array.isArray(card.rewardRules) ? card.rewardRules[0] : null;

    editingCardIndex = index;
    cardNameInput.value = card.name || card.originalName || '';
    cardLast4Input.value = card.last4 || '';
    cardNetworkInput.value = card.network || '';
    cardBaseRateInput.value = decimalToPercent(card.baseRate || 0);
    ruleNameInput.value = firstRule?.name || '';
    ruleCategoryInput.value = firstRule?.category || '';
    ruleRateInput.value = firstRule ? decimalToPercent(firstRule.rate || 0) : '';
    ruleMerchantInput.value = firstRule?.merchant || '';
    addCustomCardButton.textContent = 'Save card';
    if (customDetails) customDetails.open = true;
    setMessage(`Editing ${card.name || 'card'}.`);
  } catch (error) {
    setMessage(error.message, true);
  }
}

async function removeWalletCard(index) {
  try {
    const wallet = parseWallet();
    const [removed] = wallet.splice(index, 1);
    walletInput.value = JSON.stringify(wallet, null, 2);
    renderWalletCards();
    await persistWallet(wallet);
    setMessage(`${removed?.name || 'Card'} removed.`);
  } catch (error) {
    setMessage(error.message, true);
  }
}

function decimalToPercent(value) {
  return Math.round(Number(value || 0) * 10000) / 100;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
async function persistWallet(wallet) {
  await chrome.storage.local.set({
    apiUrl: apiUrlInput.value.trim(),
    autoAnalyze: autoAnalyzeInput.checked,
    wallet
  });
}
async function saveSettings() {
  try {
    const wallet = parseWallet();
    await chrome.storage.local.set({
      apiUrl: apiUrlInput.value.trim(),
      autoAnalyze: autoAnalyzeInput.checked,
      wallet
    });
    setMessage('Saved.');
    await checkHealth();
  } catch (error) {
    setMessage(error.message, true);
  }
}

async function analyzeCheckout() {
  setBusy(true);
  try {
    const wallet = parseWallet();
    await chrome.storage.local.set({
      apiUrl: apiUrlInput.value.trim(),
      autoAnalyze: autoAnalyzeInput.checked,
      wallet
    });

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    ensureSupportedTab(tab);

    const context = await sendPageMessage(tab.id, { type: 'CRED_IQ_COLLECT_PAGE' });
    const result = await requestRecommendation(context, wallet);

    await sendPageMessage(tab.id, { type: 'CRED_IQ_SHOW_RESULT', payload: result });
    setMessage('Recommendation shown on page.');
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    setBusy(false);
  }
}

function ensureSupportedTab(tab) {
  if (!tab?.id) throw new Error('No active tab found.');
  const url = tab.url || '';
  if (/^(chrome|edge|about|devtools):/i.test(url)) {
    throw new Error('Open a normal shopping page, like Amazon cart, then click Analyze checkout. Browser settings pages cannot be analyzed.');
  }
}

async function sendPageMessage(tabId, payload) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (error) {
    if (!String(error.message || '').includes('Receiving end does not exist')) {
      throw error;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/contentScript.js']
    });
    return chrome.tabs.sendMessage(tabId, payload);
  }
}
async function requestRecommendation(context, wallet) {
  const response = await fetch(`${apiUrlInput.value.trim().replace(/\/$/, '')}/recommend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...context, wallet })
  });

  const result = await readJsonResponse(response);
  if (!response.ok || result.error) {
    throw new Error(result.error || `API returned ${response.status}`);
  }
  return result;
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return { error: `API returned unreadable JSON with status ${response.status}. Restart the CredIQ API and try again.` };
  }
}

async function checkHealth() {
  try {
    const response = await fetch(`${apiUrlInput.value.trim().replace(/\/$/, '')}/health`);
    const health = await response.json();
    statusDot.classList.toggle('ready', Boolean(health.ok && health.aiConfigured));
    if (!health.aiConfigured) {
      const provider = health.aiProvider || 'AI';
      setMessage(`API is running, but ${provider} is not ready. Check local AI setup.`, true);
    }
  } catch {
    statusDot.classList.remove('ready');
  }
}

function parseWallet() {
  let wallet;
  try {
    wallet = JSON.parse(walletInput.value || '[]');
  } catch {
    throw new Error('Wallet JSON is invalid.');
  }
  if (!Array.isArray(wallet)) throw new Error('Wallet must be a JSON array.');
  for (const card of wallet) {
    if (!card.id || !card.name) throw new Error('Each card needs id and name.');
    if (typeof card.baseRate !== 'number') throw new Error(`${card.name} needs numeric baseRate.`);
  }
  return wallet;
}

function setBusy(isBusy) {
  analyzeButton.disabled = isBusy;
  saveButton.disabled = isBusy;
  analyzeButton.textContent = isBusy ? 'Analyzing...' : 'Analyze checkout';
}

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle('error', isError);
}
