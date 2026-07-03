# CredIQ API

Tiny local API for AI-backed checkout analysis and deterministic credit-card reward scoring.

Default free provider: Ollama.

Run:

```powershell
copy .env.example .env
ollama pull llama3.2:3b
node server.js
```

Health check:

```powershell
Invoke-RestMethod http://localhost:8787/health
```