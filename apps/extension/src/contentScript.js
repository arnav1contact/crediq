(() => {
  const STATE_KEY = '__credIqLoaded';
  if (window[STATE_KEY]) return;
  window[STATE_KEY] = true;

  const ANALYSIS_DELAY_MS = 1600;
  const MAX_VISIBLE_TEXT = 18000;
  let lastOverlayPayload = null;
  let autoAnalysisTimer = null;
  let lastAutoAnalysisSignature = '';

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'CRED_IQ_COLLECT_PAGE') {
      sendResponse(collectCheckoutContext());
      return true;
    }

    if (message?.type === 'CRED_IQ_SHOW_RESULT') {
      showOverlay(message.payload);
      sendResponse({ ok: true });
      return true;
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.themeMode && lastOverlayPayload) {
      showOverlay(lastOverlayPayload);
    }
  });

  scheduleAutoAnalysis(false, ANALYSIS_DELAY_MS);
  installCartChangeWatcher();

  function scheduleAutoAnalysis(force = false, delay = 900) {
    window.clearTimeout(autoAnalysisTimer);
    autoAnalysisTimer = window.setTimeout(() => {
      runAutoAnalysis({ force }).catch((error) => {
        console.debug('CredIQ auto-analysis skipped:', error.message);
      });
    }, delay);
  }

  async function runAutoAnalysis(options = {}) {
    if (!looksLikeCheckoutPage()) return;

    const { apiUrl = 'http://localhost:8787', wallet = [], autoAnalyze = true } = await chrome.storage.local.get(['apiUrl', 'wallet', 'autoAnalyze']);
    if (!autoAnalyze || !Array.isArray(wallet) || wallet.length === 0) return;

    const context = collectCheckoutContext();
    const analysisKey = makeAnalysisKey(context);
    if (analysisKey === lastAutoAnalysisSignature) return;
    if (!options.force && sessionStorage.getItem(analysisKey)) return;
    lastAutoAnalysisSignature = analysisKey;
    sessionStorage.setItem(analysisKey, '1');

    showOverlay({ loading: true, message: options.force ? 'Updating card pick...' : 'Checking best card...' });

    const response = await fetch(`${String(apiUrl).replace(/\/$/, '')}/recommend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...context, wallet })
    });

    const result = await readJsonResponse(response);
    if (!response.ok || result.error) {
      showOverlay({ error: result.error || `API returned ${response.status}` });
      return;
    }

    showOverlay(result);
  }

  async function readJsonResponse(response) {
    try {
      return await response.json();
    } catch {
      return { error: `API returned unreadable JSON with status ${response.status}. Restart the CredIQ API and try again.` };
    }
  }

  function collectCheckoutContext() {
    const bodyText = cleanText(document.body?.innerText || '');
    const structuredCart = extractStructuredCart(bodyText);

    return {
      pageUrl: location.href,
      pageTitle: document.title,
      merchant: detectMerchant(location.hostname),
      subtotalText: structuredCart.subtotalText || findSubtotalText(bodyText),
      visibleText: (structuredCart.visibleText || bodyText).slice(0, MAX_VISIBLE_TEXT),
      structuredCart,
      selectedPayment: detectSelectedPayment(bodyText)
    };
  }

  function extractStructuredCart(bodyText) {
    const merchant = detectMerchant(location.hostname);
    const extractors = [extractCredIqTestCart, extractAmazonCart, extractGenericCart];
    for (const extractor of extractors) {
      const result = extractor();
      if (result.blockAnalysis || result.items.length > 0 || result.subtotal !== null) {
        return {
          source: result.source,
          merchant,
          purchaseStage: detectPurchaseStage(),
          subtotal: result.subtotal,
          subtotalText: result.subtotalText || findSubtotalText(bodyText),
          visibleText: result.visibleText || '',
          blockAnalysis: Boolean(result.blockAnalysis),
          blockReason: result.blockReason || '',
          selectionAvailable: Boolean(result.selectionAvailable),
          selectedItemCount: Number(result.selectedItemCount || 0),
          items: result.items.slice(0, 30)
        };
      }
    }

    return {
      source: 'page_text',
      merchant,
      purchaseStage: detectPurchaseStage(),
      subtotal: parseMoney(findSubtotalText(bodyText)),
      subtotalText: findSubtotalText(bodyText),
      items: []
    };
  }

  function extractCredIqTestCart() {
    const rows = [...document.querySelectorAll('[data-crediq-item]')];
    return {
      source: 'crediq_test_selectors',
      subtotal: parseMoney(document.querySelector('[data-crediq-subtotal]')?.textContent || ''),
      subtotalText: cleanText(document.querySelector('[data-crediq-subtotal]')?.textContent || ''),
      items: rows.map((row) => ({
        name: cleanText(row.querySelector('[data-crediq-name]')?.textContent || row.getAttribute('data-name') || ''),
        price: parseMoney(row.querySelector('[data-crediq-price]')?.textContent || row.getAttribute('data-price') || ''),
        quantity: parseQuantity(row.querySelector('[data-crediq-qty]')?.textContent || row.getAttribute('data-qty') || '1')
      })).filter((item) => item.name)
    };
  }

  function extractAmazonCart() {
    if (!location.hostname.toLowerCase().includes('amazon.')) return emptyExtraction('amazon_selectors');

    const activeRoots = findAmazonActiveCartRoots();
    const candidateRows = getCanonicalAmazonCartRows(activeRoots).filter((row) => !isExcludedAmazonCartRow(row));
    const selection = filterSelectedCartRows(candidateRows);

    if (selection.selectionAvailable && selection.rows.length === 0) {
      return {
        source: 'amazon_no_selected_items',
        subtotal: null,
        subtotalText: '',
        visibleText: '',
        items: [],
        blockAnalysis: true,
        blockReason: 'This Amazon cart has selectable items, but none are selected. Select at least one item in the cart before asking CredIQ to analyze it.',
        selectionAvailable: true,
        selectedItemCount: 0
      };
    }

    const rows = selection.rows;
    const items = rows
      .map((row) => amazonItemFromRow(row))
      .filter((item) => item.name && item.name.length > 2 && item.price !== null);

    const selectedSubtotal = sumExtractedItems(items);
    const documentSubtotalText = firstDocumentText([
      '#sc-subtotal-label-activecart + span', '#sc-subtotal-amount-activecart .a-offscreen', '[data-name="Subtotals"] .a-offscreen', '#subtotals-marketplace-table .a-offscreen'
    ]) || findSubtotalText(activeRoots.map((root) => root.innerText || '').join('\n'));
    const rowSubtotalText = findSubtotalText(rows.map((row) => row.innerText || '').join('\n'));
    const subtotalText = selection.selectionAvailable
      ? `Selected items: $${Number(selectedSubtotal || 0).toFixed(2)}`
      : (documentSubtotalText || rowSubtotalText);

    return {
      source: selection.selectionAvailable ? 'amazon_selected_cart_selectors' : 'amazon_active_cart_selectors',
      subtotal: selection.selectionAvailable ? selectedSubtotal : (parseMoney(subtotalText) ?? selectedSubtotal),
      subtotalText: cleanText(subtotalText),
      visibleText: cleanText(rows.map((row) => row.innerText || '').join('\n')).slice(0, MAX_VISIBLE_TEXT),
      selectionAvailable: selection.selectionAvailable,
      selectedItemCount: selection.selectionAvailable ? rows.length : 0,
      items: dedupeItems(items)
    };
  }

  function getCanonicalAmazonCartRows(roots) {
    const candidates = roots.flatMap((root) => [...root.querySelectorAll('.sc-list-item, li.sc-item, [data-itemid], [data-asin]')]);
    const rows = candidates.map((row) => row.closest('.sc-list-item, li.sc-item') || row.closest('[data-itemid]') || row.closest('[data-asin]') || row);
    return rows.filter((row, index, list) => row && list.indexOf(row) === index);
  }

  function filterSelectedCartRows(rows) {
    const selectableRows = rows.map((row) => ({ row, input: findCartSelectionInput(row) })).filter((entry) => entry.input);
    if (selectableRows.length === 0) return { selectionAvailable: false, rows };
    return {
      selectionAvailable: true,
      rows: selectableRows.filter((entry) => isSelectionInputChecked(entry.input)).map((entry) => entry.row)
    };
  }

  function findCartSelectionInput(row) {
    const inputs = [...row.querySelectorAll('input[type="checkbox"], input[type="radio"], [role="checkbox"], [aria-checked], .sc-item-check-checkbox input, [name*="submit.delete"], [name*="selectedItems"]')];
    return inputs.find((input) => {
      if (input.disabled || input.type === 'hidden') return false;
      const label = cleanText(`${input.getAttribute('aria-label') || ''} ${input.name || ''} ${input.id || ''} ${input.className || ''} ${input.closest('label')?.innerText || ''}`);
      if (/gift|warranty|subscribe|add-on|addon/i.test(label)) return false;
      return /select|deselect|selected|selecteditems|item|cart|checkbox|sc-item-check/i.test(label);
    }) || null;
  }

  function isSelectionInputChecked(input) {
    return input.checked === true || input.getAttribute('aria-checked') === 'true';
  }

  function amazonItemFromRow(row) {
    const title = firstText(row, ['.sc-product-title', '.a-truncate-full', '[data-a-word-break]', 'h4', 'span.a-size-base-plus', '[data-cy="item-title"]']);
    const qtyText = firstText(row, ['select[name="quantity"] option:checked', '.a-dropdown-prompt', '[name="quantity"]', '[aria-label*="Quantity"]']);
    return {
      name: cleanAmazonTitle(title),
      price: bestAmazonItemPrice(row),
      quantity: parseQuantity(qtyText || '1')
    };
  }

  function bestAmazonItemPrice(row) {
    const directPriceText = firstText(row, ['.sc-product-price .a-offscreen', '.sc-product-price', '[data-cy="item-price"]', '.a-price .a-offscreen', '.a-color-price']);
    const directPrice = parseMoney(directPriceText);
    if (directPrice !== null) return directPrice;

    const lines = cleanText(row.innerText || row.textContent || '').split('\n').map((line) => line.trim()).filter(Boolean);
    const couponIndex = lines.findIndex((line) => /coupon price|price after coupon|with coupon/i.test(line));
    if (couponIndex >= 0) {
      for (const line of lines.slice(couponIndex, couponIndex + 3)) {
        const value = parseMoney(line);
        if (value !== null) return value;
      }
    }

    const prices = moneyValues(lines.join(' ')).filter((value) => value > 0 && value < 100000);
    return prices.length > 0 ? prices[0] : null;
  }

  function cleanAmazonTitle(title) {
    let value = cleanText(title)
      .replace(/\s+Opens in a new tab\s*$/i, '')
      .replace(/\s+Opens in a new tab\s*/ig, ' ')
      .trim();

    value = collapseRepeatedAmazonTitle(value);
    return value.length > 260 ? `${value.slice(0, 257).trim()}...` : value;
  }

  function collapseRepeatedAmazonTitle(value) {
    if (!value || value.length < 50) return value;
    const probe = value.slice(0, Math.min(70, Math.floor(value.length / 2))).trim();
    const secondIndex = value.indexOf(probe, probe.length);
    if (secondIndex > 35) return value.slice(0, secondIndex).trim();

    const midpoint = Math.floor(value.length / 2);
    const left = value.slice(0, midpoint).trim();
    const right = value.slice(midpoint).trim();
    if (normalizeComparableTitle(left) === normalizeComparableTitle(right)) return left;
    return value;
  }

  function normalizeComparableTitle(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function moneyValues(value) {
    return [...String(value || '').replace(/,/g, '').matchAll(/\$\s*(\d+(?:\.\d{1,2})?)/g)].map((match) => Number(match[1]));
  }

  function findAmazonActiveCartRoots() {
    const selectors = [
      '[data-name="Active Items"]',
      '#activeCartViewForm',
      '#sc-active-cart',
      '#sc-buy-box',
      '[data-testid="active-cart-view-form"]',
      '#spc-orders',
      '#checkoutDisplayPage'
    ];
    const roots = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
    const uniqueRoots = roots.filter((root, index, list) => root && list.indexOf(root) === index);
    return uniqueRoots.length > 0 ? uniqueRoots : [document.body];
  }

  function isExcludedAmazonCartRow(row) {
    const excludedContainer = row.closest('#sc-saved-cart, [data-name*="Saved"], [data-name*="saved"], [aria-label*="Saved"], [aria-label*="saved"], #rhf, #desktop-dp-sims, #similarities_feature_div, [cel_widget_id*="sims"], [data-testid*="recommend"]');
    if (excludedContainer) return true;

    const text = cleanText(row.innerText || '').toLowerCase();
    if (/saved for later|move to cart|customers who|sponsored|recommended|related to items/i.test(text)) return true;

    const heading = nearestPreviousHeadingText(row).toLowerCase();
    return /saved for later|recommended|related|sponsored|buy it again/i.test(heading);
  }

  function nearestPreviousHeadingText(element) {
    let cursor = element;
    for (let depth = 0; cursor && depth < 6; depth += 1) {
      let sibling = cursor.previousElementSibling;
      while (sibling) {
        const heading = sibling.matches?.('h1,h2,h3,[role="heading"]') ? sibling : sibling.querySelector?.('h1,h2,h3,[role="heading"]');
        const text = cleanText(heading?.innerText || heading?.textContent || '');
        if (text) return text;
        sibling = sibling.previousElementSibling;
      }
      cursor = cursor.parentElement;
    }
    return '';
  }

  function installCartChangeWatcher() {
    document.addEventListener('change', (event) => {
      if (isCartInteractionTarget(event.target)) scheduleAutoAnalysis(true);
    }, true);

    document.addEventListener('click', (event) => {
      if (isCartInteractionTarget(event.target)) scheduleAutoAnalysis(true, 1200);
    }, true);

    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => isCartInteractionTarget(mutation.target))) {
        scheduleAutoAnalysis(true, 1200);
      }
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['checked', 'aria-checked', 'class', 'value']
    });
  }

  function isCartInteractionTarget(target) {
    const element = target?.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement;
    if (!element?.closest) return false;
    const cartRoot = element.closest('#activeCartViewForm, #sc-active-cart, [data-name="Active Items"], [data-testid="active-cart-view-form"], [class*="cart"], [class*="basket"]');
    if (!cartRoot) return false;
    const label = cleanText(`${element.getAttribute?.('aria-label') || ''} ${element.getAttribute?.('name') || ''} ${element.getAttribute?.('id') || ''} ${element.className || ''}`);
    return /select|deselect|selected|quantity|qty|cart|basket|sc-item-check|checkbox/i.test(label)
      || element.matches?.('input, select, option, [role="checkbox"], [aria-checked], label, button');
  }

  function extractGenericCart() {
    const rows = [...document.querySelectorAll('[class*="cart"], [class*="basket"], [data-testid*="cart"], [data-test*="cart"]')].slice(0, 80);
    const items = [];

    for (const row of rows) {
      const text = cleanText(row.innerText || '');
      if (text.length < 12 || text.length > 600 || !/\$\s?\d/.test(text)) continue;
      const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
      const name = lines.find((line) => !/subtotal|total|checkout|shipping|tax|save for later/i.test(line) && !/^\$/.test(line));
      const priceLine = lines.find((line) => /\$\s?\d/.test(line));
      if (name && priceLine) {
        items.push({ name, price: parseMoney(priceLine), quantity: 1 });
      }
      if (items.length >= 15) break;
    }

    return {
      source: 'generic_cart_selectors',
      subtotal: parseMoney(findSubtotalText(document.body?.innerText || '')),
      subtotalText: findSubtotalText(document.body?.innerText || ''),
      items: dedupeItems(items)
    };
  }

  function emptyExtraction(source) {
    return { source, subtotal: null, subtotalText: '', items: [] };
  }

  function sumExtractedItems(items) {
    const total = items.reduce((sum, item) => {
      const price = Number(item.price);
      const qty = Number(item.quantity || 1);
      return Number.isFinite(price) ? sum + price * (Number.isFinite(qty) ? qty : 1) : sum;
    }, 0);
    return total > 0 ? Math.round(total * 100) / 100 : null;
  }

  function dedupeItems(items) {
    const seen = new Set();
    return items.filter((item) => {
      const key = `${item.name}|${item.price}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function looksLikeCheckoutPage() {
    const url = location.href.toLowerCase();
    const text = cleanText(document.body?.innerText || '').slice(0, 8000).toLowerCase();
    const urlSignals = ['cart', 'checkout', 'basket', 'buy', 'payment'];
    const textSignals = ['subtotal', 'order total', 'estimated total', 'place your order', 'proceed to checkout', 'payment method'];
    return urlSignals.some((signal) => url.includes(signal)) || textSignals.filter((signal) => text.includes(signal)).length >= 2;
  }

  function detectPurchaseStage() {
    const url = location.href.toLowerCase();
    const text = cleanText(document.body?.innerText || '').slice(0, 4000).toLowerCase();
    if (url.includes('checkout') || text.includes('place your order') || text.includes('payment method')) return 'checkout';
    if (url.includes('cart') || url.includes('basket') || text.includes('proceed to checkout')) return 'cart';
    if (text.includes('add to cart')) return 'product_page';
    return 'unknown';
  }

  function detectMerchant(hostname) {
    const host = hostname.replace(/^www\./, '').toLowerCase();
    if (host.includes('amazon.')) return 'Amazon';
    if (host.includes('walmart.')) return 'Walmart';
    if (host.includes('target.')) return 'Target';
    if (host.includes('instacart.')) return 'Instacart';
    if (host.includes('costco.')) return 'Costco';
    if (host.includes('bestbuy.')) return 'Best Buy';
    if (host === '' || host.includes('localhost') || host.includes('127.0.0.1')) return 'CredIQ Demo Store';
    return host;
  }

  function detectSelectedPayment(bodyText) {
    const selectedControl = [...document.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked')]
      .map((input) => cleanText(input.closest('label, [role="radio"], [data-testid], li, div')?.innerText || ''))
      .find((text) => /visa|mastercard|amex|american express|discover|card|payment|ending/i.test(text));

    const fromControl = parsePaymentLabel(selectedControl);
    if (fromControl) return { ...fromControl, source: 'selected_payment_control' };

    const lines = bodyText.split('\n').map((line) => line.trim()).filter(Boolean);
    const paymentIndex = lines.findIndex((line) => /payment method|paying with|payment option|card ending|ending in/i.test(line));
    const paymentLines = paymentIndex >= 0 ? lines.slice(paymentIndex, paymentIndex + 8) : lines;

    for (const line of paymentLines) {
      const parsed = parsePaymentLabel(line);
      if (parsed) return { ...parsed, source: paymentIndex >= 0 ? 'payment_section_text' : 'page_text' };
    }

    return null;
  }

  function parsePaymentLabel(text) {
    if (!text) return null;
    const line = cleanText(text).slice(0, 180);
    if (!/visa|mastercard|amex|american express|discover|card|payment|ending/i.test(line)) return null;
    const last4 = line.match(/(?:ending(?:\s+in)?|last\s*4|\*{2,}|x{2,}|\u2022{2,})\D*(\d{4})/i)?.[1]
      || line.match(/\b(?:visa|mastercard|amex|american express|discover)\D{0,40}(\d{4})\b/i)?.[1];
    if (!last4 && !/visa|mastercard|amex|american express|discover/i.test(line)) return null;
    const network = line.match(/visa|mastercard|amex|american express|discover/i)?.[0] || '';
    return { label: line, last4: last4 || '', network };
  }

  function findSubtotalText(text) {
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    return lines.find((line) => /subtotal|order total|estimated total|total before tax/i.test(line)) || '';
  }

  function firstText(root, selectors) {
    for (const selector of selectors) {
      const element = root.querySelector(selector);
      const text = cleanText(element?.innerText || element?.textContent || element?.value || '');
      if (text) return text;
    }
    return '';
  }

  function firstDocumentText(selectors) {
    for (const selector of selectors) {
      const text = cleanText(document.querySelector(selector)?.textContent || '');
      if (text) return text;
    }
    return '';
  }

  function parseMoney(value) {
    const match = String(value || '').replace(/,/g, '').match(/\$?\s*(-?\d+(?:\.\d{1,2})?)/);
    return match ? Number(match[1]) : null;
  }

  function parseQuantity(value) {
    const match = String(value || '').match(/\d+/);
    return match ? Number(match[0]) : 1;
  }

  function makeAnalysisKey(context) {
    const items = Array.isArray(context.structuredCart?.items)
      ? context.structuredCart.items.map((item) => `${item.name}:${item.price}:${item.quantity}`).join('|')
      : '';
    const fingerprint = `${context.pageUrl}|${context.subtotalText}|${context.structuredCart?.subtotal ?? ''}|${items}`;
    let hash = 0;
    for (let index = 0; index < fingerprint.length; index += 1) {
      hash = ((hash << 5) - hash + fingerprint.charCodeAt(index)) | 0;
    }
    return `credIq:${hash}`;
  }

  function cleanText(text) {
    return String(text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  async function showOverlay(payload) {
    lastOverlayPayload = payload;
    const { themeMode = 'dark' } = await chrome.storage.local.get(['themeMode']);
    const theme = themeMode === 'light' ? 'light' : 'dark';
    const old = document.getElementById('cred-iq-overlay');
    if (old) old.remove();

    const root = document.createElement('div');
    root.id = 'cred-iq-overlay';
    root.dataset.theme = theme;
    root.style.position = 'fixed';
    root.style.zIndex = '2147483647';
    root.style.right = '16px';
    root.style.bottom = '16px';
    root.style.width = '392px';
    root.style.maxWidth = 'calc(100vw - 32px)';
    root.style.fontFamily = 'Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';

    const shadow = root.attachShadow({ mode: 'open' });
    const recommendation = payload?.recommendation;
    const analysis = payload?.cartAnalysis;
    const error = payload?.error;
    const loading = payload?.loading;

    shadow.innerHTML = `
      <style>
        :host { color-scheme: dark; }
        * { box-sizing: border-box; }
        .panel {
          color: #f8fafc;
          background: #141116;
          border: 1px solid #4a4e2f;
          border-radius: 8px;
          box-shadow: 0 24px 70px rgba(0,0,0,.42), 0 0 0 1px rgba(242,201,76,.16), 0 0 34px rgba(242,201,76,.12);
          overflow: hidden;
        }
        .head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 11px 13px;
          background: linear-gradient(135deg, #f2c94c 0%, #f2c94c 48%, #b88918 100%);
          color: #11130a;
        }
        .brand { display: flex; align-items: center; gap: 8px; min-width: 0; }
.title { font-size: 13px; font-weight: 820; letter-spacing: 0; color: #11130a; }
        button { border: 0; background: rgba(255,255,255,.16); color: inherit; cursor: pointer; font-size: 16px; line-height: 1; width: 24px; height: 24px; border-radius: 6px; }
        .body { padding: 13px; background: radial-gradient(circle at top right, rgba(242,201,76,.12), transparent 36%), linear-gradient(180deg, #1e2018 0%, #141116 100%); }
        .topline { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
        .label { font-size: 10px; color: #a1a8b3; text-transform: uppercase; letter-spacing: .04em; font-weight: 800; }
        .card { font-size: 19px; font-weight: 850; margin-top: 4px; color: #ffffff; }
        .pill { flex: 0 0 auto; display: inline-flex; align-items: center; border: 1px solid rgba(242,201,76,.52); border-radius: 999px; padding: 3px 8px; font-size: 11px; font-weight: 760; color: #ffe8a3; background: rgba(242,201,76,.14); }
        .moneyBox { margin-top: 10px; padding: 10px; border: 1px solid rgba(242,201,76,.28); border-radius: 7px; background: linear-gradient(135deg, rgba(242,201,76,.15), rgba(36,27,36,.78)); }
        .money { font-size: 15px; color: #f2c94c; font-weight: 850; }
        .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; margin-top: 10px; }
        .stat { min-width: 0; padding: 8px; border-radius: 7px; border: 1px solid #3c3f2c; background: #202217; }
        .statLabel { font-size: 9px; color: #9ca3af; text-transform: uppercase; letter-spacing: .04em; font-weight: 850; }
        .statValue { margin-top: 3px; color: #f8fafc; font-size: 12px; font-weight: 850; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .paymentCheck { margin-top: 10px; padding: 9px 10px; border-radius: 7px; border: 1px solid rgba(242,201,76,.32); background: rgba(242,201,76,.10); color: #ffe8a3; font-size: 12px; line-height: 1.4; font-weight: 720; }
        .paymentCheck.good { border-color: rgba(148, 163, 184, .28); background: rgba(148, 163, 184, .10); color: #e5e7eb; }
        .paymentCheck.warn { border-color: rgba(242,201,76,.48); background: rgba(242,201,76,.14); color: #ffe8a3; }
        .why, .caveat, .loading, .meta { font-size: 12px; line-height: 1.45; color: #d1d5db; margin-top: 9px; }
        .loading { margin-top: 0; font-weight: 760; color: #f8fafc; }
        .caveat { color: #ffe8a3; }
        .error { font-size: 13px; color: #ffe8a3; line-height: 1.45; }
        details { margin-top: 11px; border-top: 1px solid #3c3f2c; padding-top: 10px; }
        summary { cursor: pointer; font-size: 12px; font-weight: 800; color: #f2c94c; }
        .list { display: grid; gap: 7px; margin-top: 9px; }
        .sectionTitle { font-size: 10px; color: #9ca3af; text-transform: uppercase; letter-spacing: .04em; font-weight: 850; margin-top: 4px; }
        .item { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: #e5e7eb; padding: 7px 8px; border-radius: 6px; background: #202217; border: 1px solid #3c3f2c; }
        .item strong { color: #f8fafc; white-space: nowrap; }
        .muted { color: #9ca3af; }
        :host([data-theme="light"]) { color-scheme: light; }
        :host([data-theme="light"]) .panel { color: #171a1f; background: #ffffff; border-color: #d9dee8; box-shadow: 0 24px 70px rgba(17,24,39,.16), 0 0 0 1px rgba(228,181,31,.12); }
        :host([data-theme="light"]) .head { background: #ffffff; color: #171a1f; border-bottom: 1px solid #e7eaf0; box-shadow: inset 4px 0 0 #e4b51f; }
        :host([data-theme="light"]) .body { background: linear-gradient(180deg, #ffffff 0%, #f7f8fb 100%); }
        :host([data-theme="light"]) .card,
        :host([data-theme="light"]) .statValue,
        :host([data-theme="light"]) .item strong { color: #1d1a12; }
        :host([data-theme="light"]) .why,
        :host([data-theme="light"]) .meta,
        :host([data-theme="light"]) .item { color: #4f493a; }
        :host([data-theme="light"]) .stat,
        :host([data-theme="light"]) .item { background: #ffffff; border-color: #d9dee8; }
        :host([data-theme="light"]) .moneyBox,
        :host([data-theme="light"]) .paymentCheck.warn { background: #fff8d8; border-color: rgba(228,181,31,.36); }
        :host([data-theme="light"]) .money,
        :host([data-theme="light"]) summary { color: #8b6700; }
        :host([data-theme="light"]) .pill { color: #6f5010; background: #fff8d8; border-color: rgba(228,181,31,.36); }
      </style>
      <div class="panel">
        <div class="head">
          <div class="brand"><div class="title">CredIQ</div></div>
          <button aria-label="Close">x</button>
        </div>
        <div class="body">
          ${loading ? `<div class="loading">${escapeHtml(payload.message || 'Analyzing checkout...')}</div>` : error ? `<div class="error">${escapeHtml(error)}</div>` : renderRecommendation(payload, recommendation, analysis)}
        </div>
      </div>
    `;

    shadow.querySelector('button')?.addEventListener('click', () => root.remove());
    document.documentElement.appendChild(root);
  }

  function renderRecommendation(payload, recommendation, analysis) {
    if (!recommendation) {
      return '<div class="error">No recommendation yet. Add cards and analyze checkout again.</div>';
    }

    const caveat = analysis?.caveats?.[0] || 'Rewards may depend on the merchant category code used by your card issuer.';
    const confidence = Math.round(Number(analysis?.confidence || 0.5) * 100);
    const mode = recommendation.recommendationMode || 'reward match';
    const alternatives = Array.isArray(payload?.alternatives) ? payload.alternatives : [];
    const items = Array.isArray(analysis?.items) ? analysis.items : [];
    const paymentCheck = payload?.paymentCheck;

    return `
      <div class="topline">
        <div>
          <div class="label">Best card</div>
          <div class="card">${escapeHtml(recommendation.cardName)}${recommendation.last4 ? ` - ${escapeHtml(recommendation.last4)}` : ''}</div>
        </div>
        <span class="pill">${escapeHtml(mode)}</span>
      </div>
      <div class="moneyBox"><div class="money">Est. $${Number(recommendation.estimatedRewardValue || 0).toFixed(2)} back / ${(Number(recommendation.effectiveRate || 0) * 100).toFixed(2)}%</div></div>
      ${renderMoneyStats(recommendation, analysis)}
      <div class="why">${escapeHtml(recommendation.why || '')}</div>
      ${renderPaymentCheck(paymentCheck)}
      <div class="meta">Detected ${escapeHtml(analysis?.merchant || 'merchant')} / ${escapeHtml(analysis?.purchaseStage || 'unknown')} / confidence ${confidence}%</div>
      <details>
        <summary>Details</summary>
        <div class="list">
          ${renderOriginalCardName(recommendation)}
          <div class="sectionTitle">Alternatives</div>
          ${renderAlternatives(alternatives)}
          <div class="sectionTitle">Detected Items</div>
          ${renderDetectedItems(items)}
        </div>
      </details>
      <div class="caveat">${escapeHtml(caveat)}</div>
    `;
  }

  function renderMoneyStats(recommendation, analysis) {
    const subtotal = Number(recommendation.subtotal ?? analysis?.subtotal ?? 0);
    const cashback = Number(recommendation.cashBackValue ?? recommendation.estimatedRewardValue ?? 0);
    const net = Number(recommendation.netAfterRewards ?? Math.max(0, subtotal - cashback));
    return `
      <div class="stats">
        <div class="stat"><div class="statLabel">Items</div><div class="statValue">${Number(analysis?.itemCount || analysis?.items?.length || 0)}</div></div>
        <div class="stat"><div class="statLabel">Total</div><div class="statValue">$${subtotal.toFixed(2)}</div></div>
        <div class="stat"><div class="statLabel">After cash back</div><div class="statValue">$${net.toFixed(2)}</div></div>
      </div>
    `;
  }

  function renderOriginalCardName(recommendation) {
    if (!recommendation?.originalCardName || recommendation.originalCardName === recommendation.cardName) return '';
    return `<div class="sectionTitle">Original card</div><div class="item"><span>${escapeHtml(recommendation.originalCardName)}</span><strong>${escapeHtml(recommendation.cardName)}</strong></div>`;
  }

  function renderPaymentCheck(paymentCheck) {
    if (!paymentCheck || paymentCheck.status === 'unknown') return '';
    const className = paymentCheck.status === 'switch_recommended' ? 'paymentCheck warn' : 'paymentCheck good';
    return `<div class="${className}">${escapeHtml(paymentCheck.message || '')}</div>`;
  }

  function renderAlternatives(alternatives) {
    if (alternatives.length === 0) return '<div class="item muted"><span>No alternatives available</span></div>';
    return alternatives.slice(0, 3).map((alt) => `
      <div class="item"><span>${escapeHtml(alt.cardName)}</span><strong>$${Number(alt.estimatedRewardValue || 0).toFixed(2)}</strong></div>
    `).join('');
  }

  function renderDetectedItems(items) {
    if (items.length === 0) return '<div class="item muted"><span>No item-level details detected yet</span></div>';
    return items.slice(0, 5).map((item) => `
      <div class="item"><span>${escapeHtml(item.name)} <span class="muted">${escapeHtml(item.category || 'other')}</span></span><strong>${item.price == null ? '' : `$${Number(item.price).toFixed(2)}`}</strong></div>
    `).join('');
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }
})();
