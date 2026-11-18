# GPT Fast

DeepSeek Harness's pi-ai adapter never sends `service_tier`, so the tier cannot
be chosen from the Models page. A Responses API proxy may also reject
model ids it does not know. This plugin closes both gaps at the request
boundary: it keeps the model id the client asks for, rewrites it to the real
upstream id, and adds `service_tier` before the body leaves the process.

## How it works

For `POST …/responses` JSON bodies sent to a configured host, the plugin:

1. reads `body.model`;
2. looks the id up in the `models` table;
3. replaces `body.model` with its `model` value and sets `body.service_tier`;
4. drops `content-length` so the new body is framed correctly.

Every other request passes through untouched. The wrapper is installed once per
process and removed when the plugin unloads.

## Configuration

```yaml
- id: gpt-fast
  name: '@local/gpt-fast'
  config:
    hosts: [proxy.example.com]
    models:
      gpt-6.2-sol-fast:
        model: gpt-6.2-sol
        serviceTier: priority
      gpt-6.2-sol-ultrafast:
        model: gpt-6.2-sol
        serviceTier: ultrafast
      gpt-6.2-astra-fast:
        model: gpt-6.2-astra
        serviceTier: priority
```

| Field | Meaning |
|---|---|
| `hosts` | Hostnames whose `/responses` calls are inspected. Set these in your local profile; the default is empty and rewrites nothing. |
| `models.<id>.model` | Upstream model id sent to the proxy (defaults to `<id>`). |
| `models.<id>.serviceTier` | Wire value for `service_tier`, e.g. `priority` or `ultrafast` (default `priority`). |
| `debug` | Reserved; the plugin never logs request bodies or credentials. |

Each key in `models` must also exist as a model row on the provider route, so the
Models page can offer it:

```yaml
- id: gpt-6.2-sol-fast
  name: GPT-6.2 Sol Fast
  input: [text, image]
  reasoningEfforts:
    low: low
    medium: medium
    high: high
    xhigh: xhigh
    max: max
```

## Limitations

- Only plain JSON string request bodies are rewritten; a pre-streamed body is
  left alone.
- The tier is a property of the model id, not a per-message control: switching
  tier means switching model in the picker.
- The proxy reports `service_tier: "default"` in responses even when a fast tier
  ran, so judge it by latency, not by that field.
- Fast tiers consume more of the account's allowance ("2x speed, increased
  usage" per the Codex model catalog).
