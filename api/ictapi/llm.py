"""Optional language model that only rewrites the ICT Assistant's answer in friendlier words.

Providers (chosen in the admin panel, or by a user with their own key):
  anthropic   Claude, Anthropic's Messages API
  openai      OpenAI
  gemini      Google Gemini (its OpenAI-compatible endpoint)
  openrouter  OpenRouter (many models, some free)
  groq        Groq
  custom      any OpenAI-compatible endpoint: ICT_LLM_BASE_URL / ICT_LLM_API_KEY / ICT_LLM_MODEL in api/.env
Nothing runs on the server itself. Without a key the assistant answers on its own (templates), so the
feature never depends on an outside service, and the model only ever sees the engine's FACTS.
"""
from __future__ import annotations

import os

import requests

SYSTEM = ("You are the ICT Terminal chart assistant. Rewrite the FACTS below as a short, clear answer to the "
          "user's question in {language}. Use only the numbers and levels given in FACTS; never invent prices, "
          "never give financial advice or tell the user to buy or sell. At most 4 sentences.")
LANGUAGES = {"en": "English", "ur": "Roman Urdu (Urdu written in English letters)"}

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
OPENAI_COMPATIBLE = {
    "openai": "https://api.openai.com/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
    "openrouter": "https://openrouter.ai/api/v1",
    "groq": "https://api.groq.com/openai/v1",
}
DEFAULT_MODELS = {
    "anthropic": "claude-haiku-4-5-20251001",
    "openai": "gpt-4o-mini",
    "gemini": "gemini-2.0-flash",
    "openrouter": "meta-llama/llama-3.1-8b-instruct:free",
    "groq": "llama-3.1-8b-instant",
}


class LLM:
    def __init__(self, base_url: str | None = None, api_key: str | None = None, model: str | None = None,
                 session=None, timeout: float = 15.0, provider: str | None = None):
        self.provider = provider or "custom"
        if self.provider == "custom":
            self.base_url = (base_url if base_url is not None else os.getenv("ICT_LLM_BASE_URL", "")).rstrip("/")
            self.api_key = api_key if api_key is not None else os.getenv("ICT_LLM_API_KEY", "")
            self.model = model if model is not None else os.getenv("ICT_LLM_MODEL", "")
        else:
            self.base_url = ANTHROPIC_URL if self.provider == "anthropic" else OPENAI_COMPATIBLE.get(self.provider, "")
            self.api_key = api_key or ""
            self.model = model or DEFAULT_MODELS.get(self.provider, "")
        self.http = session or requests
        self.timeout = timeout

    @classmethod
    def from_config(cls, cfg: dict | None, session=None) -> "LLM | None":
        """An LLM from {provider, model, api_key} (the admin panel's settings), or None."""
        if not cfg or cfg.get("provider") in (None, "", "none") or not cfg.get("api_key"):
            return None
        if cfg["provider"] != "anthropic" and cfg["provider"] not in OPENAI_COMPATIBLE:
            return None
        return cls(provider=cfg["provider"], api_key=str(cfg["api_key"]), model=str(cfg.get("model") or ""), session=session)

    @property
    def enabled(self) -> bool:
        return bool(self.base_url and self.api_key and self.model)

    def rephrase(self, question: str, facts: str, lang: str = "en") -> str | None:
        """The rewritten answer, or None (disabled / error) so the caller keeps the template text."""
        if not self.enabled:
            return None
        system = SYSTEM.format(language=LANGUAGES.get(lang, "English"))
        user = f"QUESTION: {question}\nFACTS: {facts}"
        try:
            if self.provider == "anthropic":
                r = self.http.post(self.base_url, timeout=self.timeout,
                                   headers={"x-api-key": self.api_key, "anthropic-version": "2023-06-01",
                                            "content-type": "application/json"},
                                   json={"model": self.model, "max_tokens": 220, "temperature": 0.2, "system": system,
                                         "messages": [{"role": "user", "content": user}]})
                r.raise_for_status()
                parts = r.json().get("content") or []
                text = "".join(p.get("text", "") for p in parts if p.get("type") == "text").strip()
            else:
                r = self.http.post(f"{self.base_url}/chat/completions", timeout=self.timeout,
                                   headers={"Authorization": f"Bearer {self.api_key}"},
                                   json={"model": self.model, "temperature": 0.2, "max_tokens": 220,
                                         "messages": [{"role": "system", "content": system},
                                                      {"role": "user", "content": user}]})
                r.raise_for_status()
                text = r.json()["choices"][0]["message"]["content"].strip()
            return text or None
        except (requests.RequestException, ValueError, KeyError, IndexError, TypeError, AttributeError):
            return None
