const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

loadEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 8787);
const AI_PROVIDER = String(process.env.AI_PROVIDER || 'ollama').toLowerCase();
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    const aiStatus = await getAiStatus();
    writeJson(res, 200, { ok: true, ...aiStatus });
    return;
  }

  if (req.method === 'POST' && req.url === '/recommend') {
    try {
      assertAiProviderConfigured();
      const body = await readJson(req);
      const result = await recommend(body);
      writeJson(res, 200, result);
    } catch (error) {
      console.error(error);
      writeJson(res, 500, { error: error.message || 'Recommendation failed' });
    }
    return;
  }

  writeJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`CredIQ API listening on http://localhost:${PORT}`);
  console.log(`AI provider: ${AI_PROVIDER} | model: ${activeModelName()}`);
});

async function recommend(input) {
  const wallet = Array.isArray(input.wallet) ? input.wallet : [];
  if (wallet.length === 0) {
    return {
      recommendation: null,
      error: 'No cards configured. Add your wallet in the extension popup first.'
    };
  }

  const structuredCartHint = normalizeStructuredCartHint(input.structuredCart);
  if (structuredCartHint?.blockAnalysis) {
    const message = structuredCartHint.blockReason || 'No selected cart items were found. Select items in the cart before analyzing.';
    return {
      recommendation: null,
      error: message,
      cartAnalysis: {
        merchant: structuredCartHint.merchant || input.merchant || 'Unknown merchant',
        purchaseStage: structuredCartHint.purchaseStage || 'cart',
        subtotal: null,
        itemCount: 0,
        currency: 'USD',
        items: [],
        categoryTotals: [],
        merchantCategoryLikely: 'unknown',
        caveats: [message],
        confidence: 1
      },
      alternatives: [],
      generatedAt: new Date().toISOString(),
      aiProvider: AI_PROVIDER,
      aiModel: activeModelName()
    };
  }

  const cartAnalysis = await analyzeCart({
    pageUrl: input.pageUrl || '',
    pageTitle: input.pageTitle || '',
    merchant: input.merchant || '',
    subtotalText: input.subtotalText || '',
    visibleText: String(structuredCartHint?.visibleText || input.visibleText || '').slice(0, 14000),
    structuredCart: structuredCartHint
  });

  const calculations = scoreWallet(wallet, cartAnalysis);
  const best = calculations[0] || null;
  const selectedPayment = normalizeSelectedPaymentHint(input.selectedPayment);

  return {
    cartAnalysis,
    recommendation: best,
    alternatives: calculations.slice(1, 4),
    selectedPayment,
    paymentCheck: buildPaymentCheck(best, calculations, selectedPayment),
    generatedAt: new Date().toISOString(),
    aiProvider: AI_PROVIDER,
    aiModel: activeModelName()
  };
}

async function analyzeCart(context) {
  if (AI_PROVIDER === 'ollama') return analyzeCartWithOllama(context);
  if (AI_PROVIDER === 'openai') return analyzeCartWithOpenAI(context);
  throw new Error(`Unsupported AI_PROVIDER "${AI_PROVIDER}". Use "ollama" or "openai".`);
}

async function analyzeCartWithOllama(context) {
  const response = await fetch(`${OLLAMA_BASE_URL.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      format: 'json',
      options: {
        temperature: 0.1
      },
      messages: [
        {
          role: 'system',
          content: cartAnalysisInstructions()
        },
        {
          role: 'user',
          content: JSON.stringify(context)
        }
      ]
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.error ? ` ${data.error}` : '';
    throw new Error(`Ollama request failed with ${response.status}.${detail} Make sure Ollama is running and the ${OLLAMA_MODEL} model is pulled.`);
  }

  const content = data.message?.content || data.response || '';
  try {
    const parsed = parseJsonObject(content, 'Ollama');
    return normalizeCartAnalysis(parsed, context);
  } catch (error) {
    const fallback = fallbackStructuredCartAnalysis(context, error);
    if (fallback) return fallback;
    throw new Error('AI returned invalid JSON. Try again, or reload the page if the cart changed.');
  }
}

async function analyzeCartWithOpenAI(context) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: 'system',
          content: cartAnalysisInstructions()
        },
        {
          role: 'user',
          content: JSON.stringify(context)
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'cart_reward_analysis',
          strict: true,
          schema: cartAnalysisSchema()
        }
      }
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || `OpenAI request failed with ${response.status}`);
  }

  const text = data.output_text || data.output?.flatMap((item) => item.content || []).find((part) => part.type === 'output_text')?.text;
  if (!text) {
    throw new Error('OpenAI response did not include structured text output.');
  }

  try {
    return normalizeCartAnalysis(JSON.parse(text), context);
  } catch (error) {
    const fallback = fallbackStructuredCartAnalysis(context, error);
    if (fallback) return fallback;
    throw new Error('AI returned invalid JSON. Try again, or reload the page if the cart changed.');
  }
}

function fallbackStructuredCartAnalysis(context, error) {
  const cart = context.structuredCart;
  if (!cart || typeof cart !== 'object') return null;
  const hasItems = Array.isArray(cart.items) && cart.items.length > 0;
  const hasSubtotal = toNullableNumber(cart.subtotal) !== null;
  if (!hasItems && !hasSubtotal) return null;

  return normalizeCartAnalysis({
    merchant: cart.merchant || context.merchant || 'Unknown merchant',
    purchaseStage: cart.purchaseStage || 'unknown',
    subtotal: cart.subtotal,
    items: [],
    categoryTotals: [],
    merchantCategoryLikely: inferMerchantCategory(context) || 'unknown',
    caveats: [`AI response was malformed, so CredIQ used the verified cart data. ${error.message}`],
    confidence: 0.62
  }, context);
}

function cartAnalysisInstructions() {
  return [
    'You classify shopping cart and checkout pages for credit card reward optimization.',
    'Extract only facts visible in the supplied page text. Be conservative.',
    'Merchant category codes may differ from item categories, so include caveats.',
    'Return only valid JSON. No markdown. No commentary.',
    'If structuredCart is provided, use those item names, quantities, prices, subtotal, purchaseStage, and scoped visibleText as strong hints.',
    'Ignore saved-for-later, sponsored, recommended, related, and buy-again products unless they are in structuredCart.items.',
    'If structuredCart.items is present, do not invent extra items from visibleText. visibleText is context only.',
    'Classify item categories from names when possible. Valid categories: grocery, dining, gas, travel, pharmacy, electronics, entertainment, home, clothing, online_shopping, warehouse, other.',
    'Required JSON shape:',
    JSON.stringify(cartAnalysisExample())
  ].join('\n');
}

function cartAnalysisExample() {
  return {
    merchant: 'Amazon',
    purchaseStage: 'cart',
    subtotal: 47.25,
    currency: 'USD',
    items: [
      { name: 'Example item', quantity: 1, price: 12.99, category: 'online_shopping', confidence: 0.7 }
    ],
    categoryTotals: [
      { category: 'online_shopping', amount: 47.25, confidence: 0.7 }
    ],
    merchantCategoryLikely: 'online retail',
    caveats: ['Issuer merchant category code may differ from visible item categories.'],
    confidence: 0.7
  };
}

function cartAnalysisSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      merchant: { type: 'string' },
      purchaseStage: { type: 'string', enum: ['cart', 'checkout', 'product_page', 'unknown'] },
      subtotal: { type: ['number', 'null'] },
      currency: { type: 'string' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            quantity: { type: ['number', 'null'] },
            price: { type: ['number', 'null'] },
            category: { type: 'string' },
            confidence: { type: 'number' }
          },
          required: ['name', 'quantity', 'price', 'category', 'confidence']
        }
      },
      categoryTotals: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            category: { type: 'string' },
            amount: { type: 'number' },
            confidence: { type: 'number' }
          },
          required: ['category', 'amount', 'confidence']
        }
      },
      merchantCategoryLikely: { type: 'string' },
      caveats: { type: 'array', items: { type: 'string' } },
      confidence: { type: 'number' }
    },
    required: ['merchant', 'purchaseStage', 'subtotal', 'currency', 'items', 'categoryTotals', 'merchantCategoryLikely', 'caveats', 'confidence']
  };
}

function normalizeCartAnalysis(value, context) {
  const allowedCategories = new Set(['grocery', 'dining', 'gas', 'travel', 'pharmacy', 'electronics', 'entertainment', 'home', 'clothing', 'online_shopping', 'warehouse', 'other']);
  const hintedItems = Array.isArray(context.structuredCart?.items) ? context.structuredCart.items : [];
  const aiItems = Array.isArray(value.items) ? value.items : [];
  const hasStructuredItems = hintedItems.length > 0;
  const fallbackCategory = inferStructuredFallbackCategory(context, value);
  const mergedItems = hasStructuredItems
    ? mergeStructuredItemsWithAiCategories(hintedItems, aiItems, allowedCategories, fallbackCategory)
    : normalizeAiItems(aiItems, allowedCategories);

  const hintedSubtotal = toNullableNumber(context.structuredCart?.subtotal);
  const subtotal = hasStructuredItems
    ? (hintedSubtotal ?? sumItemPrices(mergedItems) ?? toNullableNumber(value.subtotal))
    : (toNullableNumber(value.subtotal) ?? hintedSubtotal ?? sumItemPrices(mergedItems));

  let categoryTotals = hasStructuredItems
    ? deriveCategoryTotalsFromItems(mergedItems)
    : normalizeCategoryTotalRows(value.categoryTotals, allowedCategories);

  if (categoryTotals.length === 0 && mergedItems.length > 0) {
    categoryTotals = deriveCategoryTotalsFromItems(mergedItems);
  }

  return {
    merchant: String(context.structuredCart?.merchant || value.merchant || context.merchant || 'Unknown merchant'),
    purchaseStage: ['cart', 'checkout', 'product_page', 'unknown'].includes(value.purchaseStage) ? value.purchaseStage : (context.structuredCart?.purchaseStage || 'unknown'),
    subtotal,
    itemCount: mergedItems.reduce((sum, item) => sum + (toNullableNumber(item.quantity) ?? 1), 0),
    currency: String(value.currency || 'USD'),
    items: mergedItems,
    categoryTotals,
    merchantCategoryLikely: String(value.merchantCategoryLikely || inferMerchantCategory(context) || 'unknown'),
    caveats: Array.isArray(value.caveats) && value.caveats.length > 0 ? value.caveats.map(String) : ['Issuer merchant category code may differ from visible item categories.'],
    confidence: clamp01(value.confidence)
  };
}
function normalizeSelectedPaymentHint(value) {
  if (!value || typeof value !== 'object') return null;
  const last4 = String(value.last4 || '').replace(/\D/g, '').slice(-4);
  const label = String(value.label || '').slice(0, 180);
  const network = String(value.network || '').slice(0, 40);
  if (!last4 && !label && !network) return null;
  return {
    label,
    last4,
    network,
    source: String(value.source || 'unknown')
  };
}

function buildPaymentCheck(best, calculations, selectedPayment) {
  if (!best || !selectedPayment) {
    return { status: 'unknown', message: 'Selected payment card was not detected on this page.', savingsDelta: 0, selectedCard: null };
  }

  const selectedCard = calculations.find((card) => {
    const last4Matches = selectedPayment.last4 && String(card.last4 || '') === selectedPayment.last4;
    const nameMatches = selectedPayment.label && normalizeText(selectedPayment.label).includes(normalizeText(card.cardName));
    return last4Matches || nameMatches;
  }) || null;

  if (!selectedCard) {
    return {
      status: 'unmatched',
      message: `Detected payment card${selectedPayment.last4 ? ` ending in ${selectedPayment.last4}` : ''}, but it is not in your CredIQ wallet yet.`,
      savingsDelta: 0,
      selectedCard: null
    };
  }

  const savingsDelta = roundMoney(Number(best.estimatedRewardValue || 0) - Number(selectedCard.estimatedRewardValue || 0));
  if (selectedCard.cardId === best.cardId || savingsDelta <= 0) {
    return {
      status: 'already_best',
      message: `${selectedCard.cardName} is already the best configured card for this checkout.`,
      savingsDelta: 0,
      selectedCard
    };
  }

  return {
    status: 'switch_recommended',
    message: `Switch from ${selectedCard.cardName} to ${best.cardName} before paying to earn about $${savingsDelta.toFixed(2)} more.`,
    savingsDelta,
    selectedCard
  };
}

function normalizeStructuredCartHint(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    source: String(value.source || 'unknown'),
    merchant: String(value.merchant || ''),
    purchaseStage: String(value.purchaseStage || 'unknown'),
    subtotal: toNullableNumber(value.subtotal),
    subtotalText: String(value.subtotalText || ''),
    visibleText: String(value.visibleText || '').slice(0, 14000),
    blockAnalysis: Boolean(value.blockAnalysis),
    blockReason: String(value.blockReason || ''),
    selectionAvailable: Boolean(value.selectionAvailable),
    selectedItemCount: toNullableNumber(value.selectedItemCount) ?? 0,
    items: Array.isArray(value.items) ? value.items.slice(0, 30).map((item) => ({
      name: String(item.name || ''),
      quantity: toNullableNumber(item.quantity) ?? 1,
      price: toNullableNumber(item.price)
    })).filter((item) => item.name) : []
  };
}

function normalizeAiItems(aiItems, allowedCategories) {
  return aiItems.map((item) => ({
    name: String(item.name || 'Unknown item'),
    quantity: toNullableNumber(item.quantity) ?? 1,
    price: toNullableNumber(item.price),
    category: normalizeCategory(item.category, allowedCategories),
    confidence: clamp01(item.confidence)
  })).filter((item) => item.name && item.name !== 'Unknown item');
}

function mergeStructuredItemsWithAiCategories(hintedItems, aiItems, allowedCategories, fallbackCategory) {
  return hintedItems.map((hinted) => {
    const aiMatch = findBestAiItemMatch(hinted, aiItems);
    const category = normalizeCategory(aiMatch?.category || fallbackCategory || 'other', allowedCategories);
    return {
      name: String(hinted.name || 'Unknown item'),
      quantity: toNullableNumber(hinted.quantity) ?? 1,
      price: toNullableNumber(hinted.price),
      category,
      confidence: aiMatch ? clamp01(aiMatch.confidence) : 0.72
    };
  }).filter((item) => item.name && item.name !== 'Unknown item');
}

function findBestAiItemMatch(hinted, aiItems) {
  const hintedNorm = normalizeComparableText(hinted.name);
  if (!hintedNorm) return null;

  let best = null;
  let bestScore = 0;
  for (const item of aiItems) {
    const aiNorm = normalizeComparableText(item.name);
    if (!aiNorm) continue;
    let score = 0;
    if (hintedNorm === aiNorm) score = 1;
    else if (hintedNorm.includes(aiNorm) || aiNorm.includes(hintedNorm)) score = 0.9;
    else score = sharedTokenScore(hintedNorm, aiNorm);

    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }

  return bestScore >= 0.45 ? best : null;
}

function inferStructuredFallbackCategory(context, value) {
  const merchant = normalizeText(context.structuredCart?.merchant || context.merchant || value?.merchant || '');
  if (merchant.includes('amazon') || merchant.includes('walmart') || merchant.includes('target') || merchant.includes('best buy')) return 'online_shopping';
  return 'other';
}

function normalizeComparableText(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function sharedTokenScore(left, right) {
  const leftTokens = new Set(left.split(' ').filter((token) => token.length > 2));
  const rightTokens = new Set(right.split(' ').filter((token) => token.length > 2));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  return shared / Math.max(leftTokens.size, rightTokens.size);
}
function normalizeCategoryTotalRows(rows, allowedCategories) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    category: normalizeCategory(row.category, allowedCategories),
    amount: Math.max(0, Number(row.amount || 0)),
    confidence: clamp01(row.confidence)
  })).filter((row) => row.amount > 0);
}

function deriveCategoryTotalsFromItems(items) {
  const totals = {};
  for (const item of items) {
    const amount = toNullableNumber(item.price);
    if (amount === null) continue;
    const qty = toNullableNumber(item.quantity) ?? 1;
    const category = item.category || 'other';
    totals[category] = (totals[category] || 0) + amount * qty;
  }
  return Object.entries(totals).map(([category, amount]) => ({ category, amount: roundMoney(amount), confidence: 0.6 }));
}

function sumItemPrices(items) {
  const total = items.reduce((sum, item) => {
    const price = toNullableNumber(item.price);
    if (price === null) return sum;
    const qty = toNullableNumber(item.quantity) ?? 1;
    return sum + price * qty;
  }, 0);
  return total > 0 ? roundMoney(total) : null;
}

function inferMerchantCategory(context) {
  const merchant = normalizeText(context.merchant || context.structuredCart?.merchant || '');
  if (merchant.includes('amazon')) return 'online retail';
  if (merchant.includes('walmart') || merchant.includes('target')) return 'superstore retail';
  if (merchant.includes('instacart')) return 'grocery delivery';
  return '';
}
function parseJsonObject(text, providerName) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text).match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`${providerName} did not return JSON.`);
    return JSON.parse(match[0]);
  }
}

function scoreWallet(wallet, analysis) {
  const totals = normalizeCategoryTotals(analysis);
  const subtotal = typeof analysis.subtotal === 'number' ? analysis.subtotal : sumTotals(totals);
  const merchantContext = {
    merchant: analysis.merchant || '',
    merchantCategoryLikely: analysis.merchantCategoryLikely || ''
  };

  return wallet.map((card) => {
    const baseRate = Number(card.baseRate || 0);
    const displayName = card.name || card.originalName || 'Unnamed card';
    const originalName = card.originalName || card.name || displayName;
    let rewardValue = 0;
    const breakdown = [];

    for (const [category, amount] of Object.entries(totals)) {
      const match = bestRewardMatch(card, { category, ...merchantContext }, baseRate);
      const value = amount * match.rate;
      rewardValue += value;
      breakdown.push({ category, amount, rate: match.rate, value, matchReason: match.reason, ruleName: match.ruleName });
    }

    const uncategorized = Math.max(0, subtotal - sumTotals(totals));
    if (uncategorized > 0) {
      const match = bestRewardMatch(card, { category: 'uncategorized', ...merchantContext }, baseRate);
      const value = uncategorized * match.rate;
      rewardValue += value;
      breakdown.push({ category: 'uncategorized', amount: uncategorized, rate: match.rate, value, matchReason: match.reason, ruleName: match.ruleName });
    }

    return {
      cardId: card.id,
      cardName: displayName,
      originalCardName: originalName,
      last4: card.last4 || null,
      estimatedRewardValue: roundMoney(rewardValue),
      cashBackValue: roundMoney(rewardValue),
      effectiveRate: subtotal > 0 ? roundRate(rewardValue / subtotal) : 0,
      subtotal: roundMoney(subtotal),
      netAfterRewards: roundMoney(subtotal - rewardValue),
      recommendationMode: recommendationMode(breakdown),
      breakdown: breakdown.map((row) => ({ ...row, amount: roundMoney(row.amount), value: roundMoney(row.value) })),
      why: buildWhy({ ...card, name: displayName }, breakdown, rewardValue, merchantContext)
    };
  }).sort((a, b) => b.estimatedRewardValue - a.estimatedRewardValue);
}

function bestRewardMatch(card, context, baseRate) {
  const rules = Array.isArray(card.rewardRules) ? card.rewardRules : [];
  const baseMatch = { rate: baseRate, reason: 'base_rate', ruleName: 'Base rewards' };

  return rules.reduce((best, rule) => {
    const rate = Number(rule.rate || 0);
    if (rate < best.rate) return best;

    const categoryMatches = !rule.category || normalizeToken(rule.category) === normalizeToken(context.category);
    const merchantMatches = !rule.merchant || normalizeText(context.merchant).includes(normalizeText(rule.merchant));
    const merchantCategoryMatches = !rule.merchantCategory || normalizeText(context.merchantCategoryLikely).includes(normalizeText(rule.merchantCategory));

    if (categoryMatches && merchantMatches && merchantCategoryMatches) {
      return {
        rate,
        reason: rewardReason(rule),
        ruleName: rule.name || `${Math.round(rate * 10000) / 100}% rewards`
      };
    }

    return best;
  }, baseMatch);
}

function rewardReason(rule) {
  const parts = [];
  if (rule.merchant) parts.push(`merchant:${rule.merchant}`);
  if (rule.category) parts.push(`category:${rule.category}`);
  if (rule.merchantCategory) parts.push(`merchant_category:${rule.merchantCategory}`);
  return parts.length > 0 ? parts.join(',') : 'reward_rule';
}

function normalizeCategoryTotals(analysis) {
  const totals = {};
  if (Array.isArray(analysis.categoryTotals) && analysis.categoryTotals.length > 0) {
    for (const row of analysis.categoryTotals) {
      const category = normalizeToken(row.category || 'other');
      const amount = Number(row.amount || 0);
      if (amount > 0) totals[category] = (totals[category] || 0) + amount;
    }
  }
  return totals;
}

function buildWhy(card, breakdown, rewardValue, merchantContext) {
  const bestLine = [...breakdown].sort((a, b) => b.value - a.value)[0];
  if (!bestLine) return `${card.name} has the strongest configured reward value for this checkout.`;

  const rateText = `${Math.round(bestLine.rate * 10000) / 100}%`;
  const merchant = merchantContext.merchant || 'this merchant';
  if (bestLine.matchReason?.includes('merchant:') && bestLine.category === 'uncategorized') {
    return `${card.name} wins because this appears to be a ${merchant} checkout and it earns ${rateText} via ${bestLine.ruleName}. Estimated rewards: $${roundMoney(rewardValue).toFixed(2)}.`;
  }

  if (bestLine.matchReason?.includes('merchant:')) {
    return `${card.name} wins because ${bestLine.ruleName} matches ${merchant} and this cart. Estimated rewards: $${roundMoney(rewardValue).toFixed(2)}.`;
  }

  const ruleText = bestLine.ruleName && bestLine.ruleName !== 'Base rewards' ? ` via ${bestLine.ruleName}` : '';
  return `${card.name} performs best mostly from ${rateText} on ${bestLine.category}${ruleText}. Estimated rewards: $${roundMoney(rewardValue).toFixed(2)}.`;
}

function recommendationMode(breakdown) {
  const bestLine = [...breakdown].sort((a, b) => b.value - a.value)[0];
  if (!bestLine) return 'fallback';
  if (bestLine.matchReason?.includes('merchant:')) return 'merchant-based';
  if (bestLine.category && bestLine.category !== 'uncategorized') return 'item-based';
  return 'fallback';
}

async function getAiStatus() {
  if (AI_PROVIDER === 'openai') {
    return { aiProvider: AI_PROVIDER, aiConfigured: Boolean(OPENAI_API_KEY), model: OPENAI_MODEL };
  }

  if (AI_PROVIDER === 'ollama') {
    try {
      const response = await fetch(`${OLLAMA_BASE_URL.replace(/\/$/, '')}/api/tags`, { method: 'GET' });
      const data = await response.json().catch(() => ({}));
      const models = Array.isArray(data.models) ? data.models.map((model) => model.name) : [];
      return {
        aiProvider: AI_PROVIDER,
        aiConfigured: response.ok,
        model: OLLAMA_MODEL,
        ollamaBaseUrl: OLLAMA_BASE_URL,
        modelInstalled: models.some((name) => name === OLLAMA_MODEL || name.startsWith(`${OLLAMA_MODEL}:`)),
        installedModels: models
      };
    } catch {
      return {
        aiProvider: AI_PROVIDER,
        aiConfigured: false,
        model: OLLAMA_MODEL,
        ollamaBaseUrl: OLLAMA_BASE_URL,
        modelInstalled: false,
        installedModels: []
      };
    }
  }

  return { aiProvider: AI_PROVIDER, aiConfigured: false, model: activeModelName() };
}

function assertAiProviderConfigured() {
  if (AI_PROVIDER === 'openai' && !OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured. For free local AI, set AI_PROVIDER=ollama instead.');
  }
}

function activeModelName() {
  if (AI_PROVIDER === 'openai') return OPENAI_MODEL;
  if (AI_PROVIDER === 'ollama') return OLLAMA_MODEL;
  return 'unknown';
}

function normalizeCategory(value, allowedCategories) {
  const normalized = normalizeToken(value || 'other');
  return allowedCategories.has(normalized) ? normalized : 'other';
}

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.max(0, Math.min(1, number));
}

function sumTotals(totals) {
  return Object.values(totals).reduce((sum, value) => sum + Number(value || 0), 0);
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function roundRate(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function writeJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}
