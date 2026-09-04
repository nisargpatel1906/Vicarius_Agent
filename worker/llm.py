"""
Vicarius Agent - Multi-Provider LLM Interface
Handles multi-provider failover (Gemini -> OpenRouter -> Groq), secret sanitization,
and LangChain message compatibility.
"""

import os
import re
import json
from typing import List, Dict, Any, Optional, Union
from dotenv import load_dotenv

load_dotenv()

# Environment Configurations
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_AI_MODEL = os.getenv("OPENROUTER_MODEL", "minimax/minimax-m3:free")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_AI_MODEL = os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b")

_SECRET_ENV_VARS = (
    "OPENROUTER_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY",
    "SUPABASE_SERVICE_KEY", "SUPABASE_WORKER_KEY", "SUPABASE_KEY",
    "TELEGRAM_BOT_TOKEN", "INGEST_SECRET_TOKEN",
    "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_REFRESH_TOKEN",
)

_SECRET_PATTERNS = [
    re.compile(r"sk-or-[A-Za-z0-9._-]{8,}"),                 # OpenRouter
    re.compile(r"gsk_[A-Za-z0-9]{8,}"),                       # Groq
    re.compile(r"AIza[A-Za-z0-9_-]{10,}"),                    # Google API keys
    re.compile(r"\bBearer\s+[A-Za-z0-9._-]{8,}", re.IGNORECASE),
    re.compile(r"\b\d{6,}:[A-Za-z0-9_-]{30,}\b"),             # Telegram bot token
    re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}"),  # JWT / service keys
]


def sanitize_text(text: str) -> str:
    """Redacts secret API keys and tokens before prompt egress or logging."""
    if not text:
        return text or ""
    safe = str(text)
    for var in _SECRET_ENV_VARS:
        val = os.getenv(var)
        if val and len(val) >= 6 and val in safe:
            safe = safe.replace(val, f"[REDACTED:{var}]")
    for pat in _SECRET_PATTERNS:
        safe = pat.sub("[REDACTED]", safe)
    return safe


def safe_parse_json(text: Optional[str]) -> Optional[Any]:
    """Extracts and parses JSON object or array from LLM response markdown."""
    if not text:
        return None
    clean = re.sub(r"```[a-zA-Z]*\n?", "", text).strip()
    clean = clean.replace("```", "").strip()
    try:
        return json.loads(clean, strict=False)
    except Exception:
        pass
    
    # Try finding first { ... } or [ ... ]
    match_dict = re.search(r"(\{[\s\S]*\})", clean)
    if match_dict:
        try:
            return json.loads(match_dict.group(1), strict=False)
        except Exception:
            pass
    match_arr = re.search(r"(\[[\s\S]*\])", clean)
    if match_arr:
        try:
            return json.loads(match_arr.group(1), strict=False)
        except Exception:
            pass
    return None


def call_llm(
    messages: List[Dict[str, str]],
    temperature: float = 0.2,
    max_tokens: int = 4096,
    preferred_provider: Optional[str] = None,
) -> Optional[str]:
    """
    Calls LLM with automatic failover: Gemini -> OpenRouter -> Groq.
    All message content is secret-sanitized on input and output.
    """
    import requests

    sanitized_messages = [
        {"role": m["role"], "content": sanitize_text(m["content"])}
        for m in messages
    ]

    # 1. Primary: Gemini API
    if GEMINI_API_KEY and preferred_provider in (None, "gemini"):
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
            contents = []
            sys_instruction = None
            for m in sanitized_messages:
                if m["role"] == "system":
                    sys_instruction = {"parts": [{"text": m["content"]}]}
                else:
                    role = "user" if m["role"] == "user" else "model"
                    contents.append({"role": role, "parts": [{"text": m["content"]}]})

            payload: Dict[str, Any] = {
                "contents": contents,
                "generationConfig": {
                    "temperature": temperature,
                    "maxOutputTokens": max_tokens,
                }
            }
            if sys_instruction:
                payload["systemInstruction"] = sys_instruction

            resp = requests.post(url, json=payload, timeout=60)
            if resp.ok:
                data = resp.json()
                cands = data.get("candidates", [])
                if cands and "content" in cands[0]:
                    parts = cands[0]["content"].get("parts", [])
                    if parts and "text" in parts[0]:
                        return sanitize_text(parts[0]["text"])
            else:
                print(f"[LLM-Engine] Gemini returned HTTP {resp.status_code}. Failing over to OpenRouter...")
        except Exception as ge:
            print(f"[LLM-Engine] Gemini error ({ge}). Failing over to OpenRouter...")

    # 2. Secondary: OpenRouter
    if OPENROUTER_API_KEY and preferred_provider in (None, "openrouter"):
        try:
            resp = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://your-domain.vercel.app",
                    "X-Title": "Vicarius Academic Agent",
                },
                json={
                    "model": OPENROUTER_AI_MODEL,
                    "messages": sanitized_messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                },
                timeout=120,
            )
            if resp.ok:
                data = resp.json()
                content = data["choices"][0]["message"]["content"]
                return sanitize_text(content)
            else:
                print(f"[LLM-Engine] OpenRouter returned HTTP {resp.status_code}. Failing over to Groq...")
        except Exception as oe:
            print(f"[LLM-Engine] OpenRouter error ({oe}). Failing over to Groq...")

    # 3. Tertiary: Groq
    if GROQ_API_KEY and preferred_provider in (None, "groq"):
        try:
            resp = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": GROQ_AI_MODEL,
                    "messages": sanitized_messages,
                    "temperature": temperature,
                    "max_tokens": min(max_tokens, 4096),
                },
                timeout=60,
            )
            if resp.ok:
                data = resp.json()
                content = data["choices"][0]["message"]["content"]
                return sanitize_text(content)
            else:
                print(f"[LLM-Engine] Groq returned HTTP {resp.status_code}.")
        except Exception as gre:
            print(f"[LLM-Engine] Groq error ({gre}).")

    return None


call_llm_with_failover = call_llm
