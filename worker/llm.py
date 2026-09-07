"""
Vicarius Agent - Multi-Provider LLM Interface
Handles multi-provider failover (Gemini -> OpenRouter -> Groq), secret sanitization,
tool-call (function-calling) support, and LangChain message compatibility.
"""

import os
import re
import json
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Union
from dotenv import load_dotenv

load_dotenv()

# Environment Configurations
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_AI_MODEL = os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct:free")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_AI_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")

# Timeouts
GEMINI_TIMEOUT = int(os.getenv("GEMINI_TIMEOUT", "120"))
OPENROUTER_TIMEOUT = int(os.getenv("OPENROUTER_TIMEOUT", "120"))
GROQ_TIMEOUT = int(os.getenv("GROQ_TIMEOUT", "90"))

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

# ── Provider Rate-Limit Tracker ──────────────────────────────────────────────
# Tracks the last time each provider returned a rate-limit error (HTTP 429).
# If a provider was rate-limited within RATE_LIMIT_SKIP_SECONDS seconds, skip it.
import time as _time
_RATE_LIMIT_SKIP_SECONDS = int(os.getenv("RATE_LIMIT_SKIP_SECONDS", "30"))
_provider_rate_limit_ts: Dict[str, float] = {}  # provider -> epoch of last 429

def _record_rate_limit(provider: str) -> None:
    """Record that a provider returned HTTP 429 right now."""
    _provider_rate_limit_ts[provider] = _time.time()

def _is_rate_limited(provider: str) -> bool:
    """Return True if the provider was rate-limited within the skip window."""
    ts = _provider_rate_limit_ts.get(provider, 0.0)
    return (_time.time() - ts) < _RATE_LIMIT_SKIP_SECONDS


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


# ─────────────────────────────────────────────
# TOOL CALL RESPONSE STRUCTURE
# ─────────────────────────────────────────────

@dataclass
class ToolCall:
    """Represents a single tool invocation requested by the LLM."""
    id: str
    name: str
    arguments: Dict[str, Any]


@dataclass
class LLMResponse:
    """Structured response from the LLM, supporting both plain text and tool calls."""
    content: Optional[str] = None
    tool_calls: List[ToolCall] = field(default_factory=list)
    provider: str = "unknown"
    finish_reason: str = "stop"

    @property
    def has_tool_calls(self) -> bool:
        return len(self.tool_calls) > 0

    @property
    def is_done(self) -> bool:
        """Agent signals completion with no tool calls and a text reply."""
        return not self.has_tool_calls


def _parse_gemini_tool_calls(candidates: List[Dict]) -> List[ToolCall]:
    """Parse tool calls from Gemini API response format."""
    tool_calls = []
    for candidate in candidates:
        parts = candidate.get("content", {}).get("parts", [])
        for i, part in enumerate(parts):
            if "functionCall" in part:
                fc = part["functionCall"]
                tool_calls.append(ToolCall(
                    id=f"gemini_tc_{i}",
                    name=fc.get("name", ""),
                    arguments=fc.get("args", {}),
                ))
    return tool_calls


def _parse_openai_tool_calls(choices: List[Dict]) -> List[ToolCall]:
    """Parse tool calls from OpenAI-compatible API response format (OpenRouter/Groq)."""
    tool_calls = []
    if not choices:
        return tool_calls
    message = choices[0].get("message", {})
    for tc in message.get("tool_calls", []):
        args = tc.get("function", {}).get("arguments", "{}")
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except Exception:
                args = {}
        tool_calls.append(ToolCall(
            id=tc.get("id", f"tc_{len(tool_calls)}"),
            name=tc.get("function", {}).get("name", ""),
            arguments=args,
        ))
    return tool_calls


def _gemini_tool_schemas(tool_schemas: List[Dict]) -> List[Dict]:
    """Convert OpenAI-format tool schemas to Gemini's function declaration format."""
    declarations = []
    for schema in tool_schemas:
        fn = schema.get("function", {})
        declarations.append({
            "name": fn.get("name"),
            "description": fn.get("description", ""),
            "parameters": fn.get("parameters", {"type": "object", "properties": {}}),
        })
    return declarations


# ─────────────────────────────────────────────
# PLAIN TEXT LLM CALL (backward compat)
# ─────────────────────────────────────────────

def call_llm(
    messages: List[Dict[str, str]],
    temperature: float = 0.2,
    max_tokens: int = 4096,
    preferred_provider: Optional[str] = None,
) -> Optional[str]:
    """
    Calls LLM with automatic failover: Gemini -> OpenRouter -> Groq.
    Returns plain text response. All content is secret-sanitized.
    """
    resp = call_llm_structured(
        messages,
        temperature=temperature,
        max_tokens=max_tokens,
        preferred_provider=preferred_provider,
    )
    return resp.content if resp else None


# ─────────────────────────────────────────────
# STRUCTURED LLM CALL (with tool support)
# ─────────────────────────────────────────────

_KNOWN_TOOL_NAMES = {
    "write_file", "read_file", "list_files",
    "run_python", "run_python_file",
    "generate_notebook", "build_presentation",
    "build_report", "package_zip",
    "search_web", "generate_screenshot",
}


def _parse_text_tool_calls(text: str) -> List[ToolCall]:
    """
    Parse tool calls embedded in LLM text response across multiple standard formats:
    1. ```tool_call ... ```
    2. <tool_call> ... </tool_call>
    3. ```json ... ``` where JSON contains tool name and arguments
    4. Standalone JSON objects with {"name": ..., "arguments": ...}
    
    This ensures that regardless of which LLM is running or how it formats tool calls,
    the agent cleanly extracts every valid action.
    """
    if not text:
        return []

    tool_calls: List[ToolCall] = []
    seen_calls = set()

    def add_call(name: Any, args: Any) -> None:
        if not name or not isinstance(name, str):
            return
        name = name.strip()
        matched = None
        for known in _KNOWN_TOOL_NAMES:
            if known.lower() == name.lower():
                matched = known
                break
        if not matched:
            return

        if isinstance(args, str):
            try:
                args = json.loads(args)
            except Exception:
                args = {"raw_input": args}
        elif not isinstance(args, dict):
            args = {}

        # Deduplication signature
        try:
            sig = (matched, json.dumps(args, sort_keys=True))
        except Exception:
            sig = (matched, str(args))

        if sig not in seen_calls:
            seen_calls.add(sig)
            tool_calls.append(ToolCall(
                id=f"text_tc_{len(tool_calls)}",
                name=matched,
                arguments=args,
            ))

    def try_parse_candidate(raw: str) -> None:
        raw = raw.strip()
        if not raw:
            return
        try:
            obj = json.loads(raw)
            if isinstance(obj, list):
                for item in obj:
                    if isinstance(item, dict):
                        n = item.get("name") or item.get("tool") or item.get("tool_name") or item.get("function")
                        a = item.get("arguments", item.get("args", item.get("parameters", {})))
                        add_call(n, a)
            elif isinstance(obj, dict):
                n = obj.get("name") or obj.get("tool") or obj.get("tool_name") or obj.get("function")
                a = obj.get("arguments", obj.get("args", obj.get("parameters", {})))
                add_call(n, a)
        except Exception:
            pass

    # 1. Match ```tool_call ... ``` blocks
    for match in re.finditer(r"```tool_call\s*([\s\S]*?)```", text, re.IGNORECASE):
        try_parse_candidate(match.group(1))

    # 2. Match <tool_call> ... </tool_call> tags
    for match in re.finditer(r"<tool_call>\s*([\s\S]*?)</tool_call>", text, re.IGNORECASE):
        try_parse_candidate(match.group(1))

    # 3. Match ```json ... ``` blocks containing tool names
    for match in re.finditer(r"```(?:json)?\s*([\s\S]*?)```", text, re.IGNORECASE):
        raw_block = match.group(1).strip()
        if any(t in raw_block for t in _KNOWN_TOOL_NAMES):
            try_parse_candidate(raw_block)

    # 4. Standalone JSON objects if no calls extracted yet
    if not tool_calls:
        decoder = json.JSONDecoder()
        idx = 0
        while idx < len(text):
            brace_pos = text.find("{", idx)
            if brace_pos == -1:
                break
            try:
                obj, end_pos = decoder.raw_decode(text[brace_pos:])
                if isinstance(obj, dict):
                    n = obj.get("name") or obj.get("tool") or obj.get("tool_name") or obj.get("function")
                    a = obj.get("arguments", obj.get("args", obj.get("parameters", {})))
                    add_call(n, a)
                idx = brace_pos + max(end_pos, 1)
            except Exception:
                idx = brace_pos + 1

    return tool_calls


def _build_text_tool_schema_prompt(tool_schemas: List[Dict]) -> str:
    """
    Format tool schemas as a text description for LLMs that don't support native tool calling.
    The LLM uses this to know what tools are available and how to call them.
    """
    lines = [
        "\n\nAVAILABLE TOOLS — call them using ```tool_call blocks:\n",
    ]
    for schema in tool_schemas:
        fn = schema.get("function", {})
        name = fn.get("name", "")
        desc = fn.get("description", "")
        params = fn.get("parameters", {}).get("properties", {})
        required = fn.get("parameters", {}).get("required", [])
        
        param_lines = []
        for pname, pdef in params.items():
            req = "(required)" if pname in required else "(optional)"
            ptype = pdef.get("type", "string")
            pdesc = pdef.get("description", "")
            param_lines.append(f"    - {pname} [{ptype}] {req}: {pdesc}")
        
        lines.append(f"  {name}: {desc}")
        if param_lines:
            lines.extend(param_lines)
        lines.append("")
    
    lines.append(
        'TOOL CALL FORMAT — wrap each tool call in a ```tool_call block:\n'
        '```tool_call\n'
        '{"name": "tool_name", "arguments": {"param1": "value1", "param2": "value2"}}\n'
        '```\n'
        'You may include reasoning text before or after tool calls.\n'
        'When all deliverables are complete, respond with just text saying "TASK COMPLETE".'
    )
    return "\n".join(lines)


def _format_openai_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Format messages for OpenAI-compatible Chat Completions API (OpenRouter, Groq).
    Preserves:
    - assistant messages with tool_calls
    - tool messages with tool_call_id and content
    - user/system messages
    All text is sanitized.
    """
    formatted = []
    for m in messages:
        role = m.get("role", "user")
        content = m.get("content")
        if content is not None:
            content = sanitize_text(str(content))

        if role == "assistant":
            msg: Dict[str, Any] = {"role": "assistant"}
            msg["content"] = content if content else None
            if "tool_calls" in m and m["tool_calls"]:
                msg["tool_calls"] = m["tool_calls"]
            formatted.append(msg)
        elif role in ("tool", "function"):
            formatted.append({
                "role": "tool",
                "tool_call_id": m.get("tool_call_id", f"call_{len(formatted)}"),
                "name": m.get("name", "tool"),
                "content": content or "",
            })
        elif role == "system":
            formatted.append({"role": "system", "content": content or ""})
        else:
            formatted.append({"role": "user", "content": content or ""})

    # Deduplicate consecutive assistant messages without tool calls
    collapsed = []
    for msg in formatted:
        if (collapsed and collapsed[-1]["role"] == msg["role"] == "assistant"
                and "tool_calls" not in collapsed[-1] and "tool_calls" not in msg):
            collapsed[-1]["content"] = (collapsed[-1]["content"] or "") + "\n" + (msg["content"] or "")
        else:
            collapsed.append(msg)

    return collapsed


def _format_text_fallback_messages(messages: List[Dict[str, Any]], tool_schema_text: str = "") -> List[Dict[str, Any]]:
    """
    Format messages for plain text completion where tool messages become user messages
    and tool schema is injected into system prompt.
    """
    formatted = []
    for m in messages:
        role = m.get("role", "user")
        content = sanitize_text(str(m.get("content") or ""))

        if role in ("tool", "function"):
            tool_name = m.get("name", "tool")
            formatted.append({
                "role": "user",
                "content": f"[Tool Result from {tool_name}]:\n{content}",
            })
        elif role == "assistant":
            if m.get("tool_calls") and not content:
                calls_desc = ", ".join(tc.get("function", {}).get("name", "tool") for tc in m.get("tool_calls", []))
                content = f"[Executed tool(s): {calls_desc}]"
            formatted.append({"role": "assistant", "content": content})
        elif role == "system":
            sys_content = content
            if tool_schema_text and tool_schema_text not in sys_content:
                sys_content = sys_content + "\n\n" + tool_schema_text
            formatted.append({"role": "system", "content": sys_content})
        else:
            formatted.append({"role": "user", "content": content})

    if tool_schema_text and not any(m["role"] == "system" for m in formatted):
        formatted.insert(0, {"role": "system", "content": tool_schema_text})

    return formatted

def call_llm_structured(
    messages: List[Dict[str, str]],
    temperature: float = 0.2,
    max_tokens: int = 4096,
    preferred_provider: Optional[str] = None,
    tools: Optional[List[Dict]] = None,
) -> Optional[LLMResponse]:
    """
    Calls LLM with automatic multi-provider failover: OpenRouter -> Gemini -> Groq.
    
    Tool calling strategy:
    1. Try native tool calling (function calling API) first with OpenAI protocol preserved.
    2. If the provider returns no tool calls or fails, parse tool_call blocks from
       the text response using the robust multi-format extractor.
    
    Returns an LLMResponse with .content and/or .tool_calls.
    """
    import requests

    tool_schema_text = _build_text_tool_schema_prompt(tools) if tools else ""

    # Determine execution strategy based on user matrix
    is_openrouter_only = (preferred_provider == "openrouter_only")

    # ── 1. Primary & Fallback 1: OpenRouter (minimax/minimax-m3:free) ──────
    if OPENROUTER_API_KEY and preferred_provider in (None, "openrouter", "openrouter_only"):
        openrouter_model = "minimax/minimax-m3:free"
        max_openrouter_attempts = 3 if is_openrouter_only else 2  # 3 attempts for Diagnoser, 2 for general (Primary + Fallback 1)

        for or_attempt in range(1, max_openrouter_attempts + 1):
            tier_name = "Primary" if or_attempt == 1 else f"Fallback {or_attempt - 1}"
            # Brief backoff between consecutive attempts to avoid burning
            # through retries instantly when the provider is under load.
            if or_attempt > 1:
                _time.sleep(2)
            if _is_rate_limited("openrouter"):
                print(f"[LLM-Engine] OpenRouter is in rate-limit cooldown window. Skipping {tier_name}.")
                break

            try:
                if tools:
                    try:
                        native_messages = _format_openai_messages(messages)
                        body_with_tools: Dict[str, Any] = {
                            "model": openrouter_model,
                            "messages": native_messages,
                            "temperature": temperature,
                            "max_tokens": max_tokens,
                            "tools": tools,
                            "tool_choice": "auto",
                        }
                        resp = requests.post(
                            "https://openrouter.ai/api/v1/chat/completions",
                            headers={
                                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                                "Content-Type": "application/json",
                                "HTTP-Referer": os.getenv("APP_URL", "https://github.com/nisargpatel1906/Vicarius_Agent"),
                                "X-Title": os.getenv("APP_TITLE", "Vicarius Agent"),
                            },
                            json=body_with_tools,
                            timeout=OPENROUTER_TIMEOUT,
                        )
                        if resp.ok:
                            data = resp.json()
                            choices = data.get("choices", [])
                            tc = _parse_openai_tool_calls(choices)
                            if tc:
                                return LLMResponse(tool_calls=tc, provider="openrouter", finish_reason="tool_calls")
                            if choices:
                                content_resp = choices[0].get("message", {}).get("content", "") or ""
                                text_tc = _parse_text_tool_calls(content_resp)
                                return LLMResponse(
                                    content=sanitize_text(content_resp),
                                    tool_calls=text_tc,
                                    provider="openrouter",
                                    finish_reason="tool_calls" if text_tc else choices[0].get("finish_reason", "stop"),
                                )
                        elif resp.status_code == 429:
                            _record_rate_limit("openrouter")
                            print(f"[LLM-Engine] OpenRouter ({openrouter_model}) {tier_name} 429 rate limited.")
                            continue
                    except Exception:
                        pass

                fallback_messages = _format_text_fallback_messages(messages, tool_schema_text)
                body: Dict[str, Any] = {
                    "model": openrouter_model,
                    "messages": fallback_messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                }
                resp = requests.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                        "Content-Type": "application/json",
                        "HTTP-Referer": os.getenv("APP_URL", "https://github.com/nisargpatel1906/Vicarius_Agent"),
                        "X-Title": os.getenv("APP_TITLE", "Vicarius Agent"),
                    },
                    json=body,
                    timeout=OPENROUTER_TIMEOUT,
                )
                if resp.ok:
                    data = resp.json()
                    choices = data.get("choices", [])
                    if choices:
                        content_resp = choices[0].get("message", {}).get("content", "") or ""
                        text_tc = _parse_text_tool_calls(content_resp) if tools else []
                        return LLMResponse(
                            content=sanitize_text(content_resp),
                            tool_calls=text_tc,
                            provider="openrouter",
                            finish_reason="tool_calls" if text_tc else choices[0].get("finish_reason", "stop"),
                        )
                elif resp.status_code == 429:
                    _record_rate_limit("openrouter")
                    print(f"[LLM-Engine] OpenRouter ({openrouter_model}) {tier_name} returned 429.")
                    continue
                else:
                    print(f"[LLM-Engine] OpenRouter ({openrouter_model}) {tier_name} returned HTTP {resp.status_code}.")
            except Exception as oe:
                print(f"[LLM-Engine] OpenRouter {tier_name} error with model {openrouter_model} ({oe}).")

    if is_openrouter_only:
        print("[LLM-Engine] OpenRouter attempts exhausted for Reflexion Diagnoser.")
        return None

    # ── 2. Fallback 2 / 3: Google Gemini (gemini-2.0-flash / gemini-1.5-flash) ──────
    if GEMINI_API_KEY and preferred_provider in (None, "gemini") and not _is_rate_limited("gemini"):
        is_gemini_token = GEMINI_API_KEY.startswith("AQ.")
        if not is_gemini_token:
            gemini_candidates = ["gemini-2.0-flash", "gemini-1.5-flash"]
            for gem_model in gemini_candidates:
                try:
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{gem_model}:generateContent?key={GEMINI_API_KEY}"
                    text_msgs = _format_text_fallback_messages(messages, tool_schema_text)
                    contents = []
                    sys_instruction = None

                    for m in text_msgs:
                        role = m["role"]
                        content = m.get("content", "")
                        if role == "system":
                            sys_instruction = {"parts": [{"text": content}]}
                        elif role == "assistant":
                            contents.append({"role": "model", "parts": [{"text": content}]})
                        else:
                            contents.append({"role": "user", "parts": [{"text": content}]})

                    if not contents:
                        contents = [{"role": "user", "parts": [{"text": "Begin."}]}]

                    payload: Dict[str, Any] = {
                        "contents": contents,
                        "generationConfig": {
                            "temperature": temperature,
                            "maxOutputTokens": max_tokens,
                        },
                    }
                    if sys_instruction:
                        payload["systemInstruction"] = sys_instruction

                    if tools:
                        try:
                            payload_with_tools = dict(payload)
                            payload_with_tools["tools"] = [{"function_declarations": _gemini_tool_schemas(tools)}]
                            resp = requests.post(url, json=payload_with_tools, timeout=GEMINI_TIMEOUT)
                            if resp.ok:
                                data = resp.json()
                                cands = data.get("candidates", [])
                                if cands:
                                    tc = _parse_gemini_tool_calls(cands)
                                    if tc:
                                        return LLMResponse(tool_calls=tc, provider="gemini", finish_reason="tool_calls")
                                    parts = cands[0].get("content", {}).get("parts", [])
                                    if parts and "text" in parts[0]:
                                        text = sanitize_text(parts[0]["text"])
                                        text_tc = _parse_text_tool_calls(text)
                                        return LLMResponse(
                                            content=text,
                                            tool_calls=text_tc,
                                            provider="gemini",
                                            finish_reason="tool_calls" if text_tc else cands[0].get("finishReason", "stop"),
                                        )
                        except Exception:
                            pass

                    resp = requests.post(url, json=payload, timeout=GEMINI_TIMEOUT)
                    if resp.ok:
                        data = resp.json()
                        cands = data.get("candidates", [])
                        if cands:
                            parts = cands[0].get("content", {}).get("parts", [])
                            if parts and "text" in parts[0]:
                                text = sanitize_text(parts[0]["text"])
                                text_tc = _parse_text_tool_calls(text) if tools else []
                                return LLMResponse(
                                    content=text,
                                    tool_calls=text_tc,
                                    provider="gemini",
                                    finish_reason="tool_calls" if text_tc else cands[0].get("finishReason", "stop"),
                                )
                    else:
                        status = resp.status_code
                        if status == 429:
                            _record_rate_limit("gemini")
                        print(f"[LLM-Engine] Gemini ({gem_model}) returned HTTP {status}.")
                except Exception as ge:
                    print(f"[LLM-Engine] Gemini ({gem_model}) error ({ge}).")

    # ── 3. Fallback 4: Groq ───────────────────────────────────────────
    if GROQ_API_KEY and preferred_provider in (None, "groq") and not _is_rate_limited("groq"):
        groq_candidates = [
            GROQ_AI_MODEL,
            "openai/gpt-oss-120b",
            "openai/gpt-oss-20b",
            "qwen/qwen3.8-27b",
        ]
        groq_models = list(dict.fromkeys(groq_candidates))

        for model_id in groq_models:
            try:
                # 2a. Native tool calling on Groq
                if tools:
                    try:
                        native_messages = _format_openai_messages(messages)
                        body_with_tools = {
                            "model": model_id,
                            "messages": native_messages,
                            "temperature": temperature,
                            "max_tokens": min(max_tokens, 8192),
                            "tools": tools,
                            "tool_choice": "auto",
                        }
                        resp = requests.post(
                            "https://api.groq.com/openai/v1/chat/completions",
                            headers={
                                "Authorization": f"Bearer {GROQ_API_KEY}",
                                "Content-Type": "application/json",
                            },
                            json=body_with_tools,
                            timeout=GROQ_TIMEOUT,
                        )
                        if resp.ok:
                            data = resp.json()
                            choices = data.get("choices", [])
                            tc = _parse_openai_tool_calls(choices)
                            if tc:
                                return LLMResponse(tool_calls=tc, provider="groq", finish_reason="tool_calls")
                            if choices:
                                content_resp = choices[0].get("message", {}).get("content", "") or ""
                                text_tc = _parse_text_tool_calls(content_resp)
                                return LLMResponse(
                                    content=sanitize_text(content_resp),
                                    tool_calls=text_tc,
                                    provider="groq",
                                    finish_reason="tool_calls" if text_tc else choices[0].get("finish_reason", "stop"),
                                )
                        elif resp.status_code == 429:
                            _record_rate_limit("groq")
                            print(f"[LLM-Engine] Groq ({model_id}) 429 rate limited.")
                            continue
                    except Exception:
                        pass

                # 2b. Plain text Groq call
                fallback_messages = _format_text_fallback_messages(messages, tool_schema_text)
                body = {
                    "model": model_id,
                    "messages": fallback_messages,
                    "temperature": temperature,
                    "max_tokens": min(max_tokens, 8192),
                }
                resp = requests.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {GROQ_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json=body,
                    timeout=GROQ_TIMEOUT,
                )
                if resp.ok:
                    data = resp.json()
                    choices = data.get("choices", [])
                    if choices:
                        content_resp = choices[0].get("message", {}).get("content", "") or ""
                        text_tc = _parse_text_tool_calls(content_resp) if tools else []
                        return LLMResponse(
                            content=sanitize_text(content_resp),
                            tool_calls=text_tc,
                            provider="groq",
                            finish_reason="tool_calls" if text_tc else choices[0].get("finish_reason", "stop"),
                        )
                elif resp.status_code == 429:
                    _record_rate_limit("groq")
                    print(f"[LLM-Engine] Groq ({model_id}) returned 429.")
                    continue
                else:
                    print(f"[LLM-Engine] Groq ({model_id}) returned HTTP {resp.status_code}.")
            except Exception as gre:
                print(f"[LLM-Engine] Groq error ({gre}).")

    return None


# Backward-compatible alias
call_llm_with_failover = call_llm
