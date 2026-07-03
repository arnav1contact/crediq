# CredIQ

AI-powered credit-card recommendation at checkout.

CredIQ starts with the practical MVP shape:

- Desktop browser extension for Chromium-based browsers.
- Free local AI by default through Ollama.
- Optional OpenAI provider later if we want higher accuracy.
- Deterministic reward math after the AI extracts purchase structure.
- Merchant-aware reward rules for cards like Prime Visa, store cards, grocery bonuses, online-shopping bonuses, and flat-rate cards.
- Architecture that can later branch into Safari extension, Firefox extension, Android browser support, payment-time hints, and merchant partnerships.

## Why There Is A Backend

The extension reads the checkout page and sends a compact cart snapshot to the local CredIQ API. The API calls the configured AI provider, then runs deterministic reward math.

The default provider is Ollama, which runs a real local model on your computer with no per-request API cost and no API key.

## Free Local AI Setup

Install Ollama, then pull the starter model:

```powershell
ollama pull llama3.2:3b
```

CredIQ uses this by default:

```env
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b
PORT=8787
```

If you later want paid OpenAI accuracy, switch `.env` to `AI_PROVIDER=openai` and add `OPENAI_API_KEY`.

## Quick Start

From this repo:

```powershell
cd apps\api
copy .env.example .env
node server.js
```

Then load the extension:

1. Open Chrome or Edge.
2. Go to `chrome://extensions` or `edge://extensions`.
3. Enable Developer Mode.
4. Click Load unpacked.
5. Select `apps/extension`.
6. Open the extension popup and set API URL to `http://localhost:8787`.
7. Click Example to load a starter wallet, or paste your own cards.
8. Save settings.
9. Visit a checkout/cart page. CredIQ can auto-analyze likely checkout pages, or you can click Analyze checkout.

## Wallet JSON Shape

```json
[
  {
    "id": "prime-visa",
    "name": "Prime Visa",
    "network": "Visa",
    "last4": "1001",
    "baseRate": 0.01,
    "rewardRules": [
      { "name": "Amazon purchases", "merchant": "Amazon", "rate": 0.05 },
      { "name": "Whole Foods", "merchant": "Whole Foods", "category": "grocery", "rate": 0.05 }
    ]
  },
  {
    "id": "bofa-customized-cash",
    "name": "Bank of America Customized Cash",
    "network": "Visa",
    "last4": "1234",
    "baseRate": 0.01,
    "rewardRules": [
      { "name": "Online shopping choice category", "category": "online_shopping", "rate": 0.03 },
      { "name": "Grocery stores", "category": "grocery", "rate": 0.02 }
    ]
  }
]
```

Rates are decimals: `0.03` means 3% cash back.

A reward rule can match by:

- `category`: AI-inferred item/cart category, such as `grocery`, `pharmacy`, `electronics`, or `online_shopping`.
- `merchant`: visible merchant name, such as `Amazon` or `Walmart`.
- `merchantCategory`: AI-inferred likely merchant category text.

If a rule includes multiple fields, all of them must match. CredIQ chooses the highest matching rate for each part of the cart, then compares all saved cards.

## Current Limitations

- The first extension target is desktop Chromium.
- iPhone support should be a Safari Web Extension target using the same core logic.
- Native Amazon/Walmart app scanning is not part of the first build because iOS blocks normal apps from reading other apps' screens.
- Reward math is only as accurate as the reward rules the user enters.
- Merchant category codes can differ from item categories, so the API returns confidence and caveats.
- Local AI quality depends on the Ollama model. `llama3.2:3b` is free and light, but larger models may classify carts better.