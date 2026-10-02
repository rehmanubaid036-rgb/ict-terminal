"""Optional language model that only rewrites the ICT Assistant's answer in friendlier words.

Any OpenAI-compatible chat endpoint works, including free tiers:
  Groq       ICT_LLM_BASE_URL=https://api.groq.com/openai/v1                       ICT_LLM_MODEL=llama-3.1-8b-instant
  Gemini     ICT_LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai  ICT_LLM_MODEL=gemini-2.0-flash
  OpenRouter ICT_LLM_BASE_URL=https://openrouter.ai/api/v1                        ICT_LLM_MODEL=<a :free model>
plus ICT_LLM_API_KEY. Nothing runs on the server itself. Without a key the assistant answers on
its own (templates), so the feature never depends on an outside service.
"""
from __future__ import annotations

import os

import requests

SYSTEM = ("You are the ICT Terminal chart assistant. Rewrite the FACTS below as a short, clear answer to the "
          "user's question in {language}. Use only the numbers and levels given in FACTS; never invent prices, "
          "never give financial advice or tell the user to buy or sell. At most 4 sentences.")
LANGUAGES = {"en": "English", "ur": "Roman Urdu (Urdu written in English letters)"}


class LLM:
    def __init__(self, base_url: str | None = None, api_key: str | None = None, model: str | None = None,
                 session=None, timeout: float = 15.0):
        self.base_url = (base_url if base_url is not None else os.getenv("ICT_LLM_BASE_URL", "")).rstrip("/")
        self.api_key = api_key if api_key is not None else os.getenv("ICT_LLM_API_KEY", "")
        self.model = model if model is not None else os.getenv("ICT_LLM_MODEL", "")
        self.http = session or requests
        self.timeout = timeout

    @property
    def enabled(self) -> bool:
        return bool(self.base_url and self.api_key and self.model)

    def rephrase(self, question: str, facts: str, lang: str = "en") -> str | None:
        """The rewritten answer, or None (disabled / error) so the caller keeps the template text."""
        if not self.enabled:
            return None
        try:
            r = self.http.post(f"{self.base_url}/chat/completions", timeout=self.timeout,
                               headers={"Authorization": f"Bearer {self.api_key}"},
                               json={"model": self.model, "temperature": 0.2, "max_tokens": 220,
                                     "messages": [{"role": "system", "content": SYSTEM.format(language=LANGUAGES.get(lang, "English"))},
                                                  {"role": "user", "content": f"QUESTION: {question}\nFACTS: {facts}"}]})
            r.raise_for_status()
            text = r.json()["choices"][0]["message"]["content"].strip()
            return text or None
        except (requests.RequestException, ValueError, KeyError, IndexError, TypeError):
            return None
