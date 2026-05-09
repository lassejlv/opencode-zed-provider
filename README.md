# OpenCode Zed Cloud Provider

Direct OpenCode provider for Zed Cloud LLM endpoints.

This is not a proxy. OpenCode imports this package as an AI SDK provider, and
the provider calls `https://cloud.zed.dev/completions` directly using Zed
Cloud's wrapped `provider_request` format.

## What Works

- Claude, GPT, and Gemini models exposed by Zed Cloud.
- Streaming text responses.
- Tool calls for Anthropic, OpenAI-compatible, and Gemini request formats.
- Reasoning effort variants for supported Claude and GPT models.
- Model metadata generation from `https://cloud.zed.dev/models`.

## Requirements

- Node.js 20 or newer.
- npm.
- OpenCode.
- A valid Zed Cloud LLM token in `ZED_LLM_TOKEN`.

## Install

Clone and build the provider:

```sh
git clone https://github.com/lassejlv/opencode-zed-provider.git
cd opencode-zed-provider
npm install
npm run build
```

The build creates `dist/index.js`. OpenCode imports that built file directly.

## Get A Zed LLM Token

Set your token in the shell that launches OpenCode:

```sh
export ZED_LLM_TOKEN="your-zed-llm-token"
```

The token is short-lived. If requests start returning `401 Unauthorized`, mint
a new token and update `ZED_LLM_TOKEN`.

## Configure OpenCode

Add the provider to your OpenCode config, usually:

```sh
~/.config/opencode/opencode.jsonc
```

Use an absolute `file://` URL to your local build output:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "zed-cloud": {
      "npm": "file:///absolute/path/to/opencode-zed-provider/dist/index.js",
      "name": "Zed Cloud",
      "options": {
        "apiKey": "{env:ZED_LLM_TOKEN}"
      },
      "models": {
        "claude-sonnet-4-6": {
          "name": "Claude Sonnet 4.6",
          "limit": {
            "context": 1000000,
            "output": 64000
          },
          "attachment": true,
          "reasoning": true,
          "temperature": true,
          "tool_call": true,
          "variants": {
            "low": {
              "reasoningEffort": "low"
            },
            "medium": {
              "reasoningEffort": "medium"
            },
            "high": {
              "reasoningEffort": "high"
            },
            "max": {
              "reasoningEffort": "max"
            }
          }
        },
        "gpt-5-nano": {
          "name": "GPT-5 nano",
          "limit": {
            "context": 400000,
            "output": 128000
          },
          "attachment": true,
          "reasoning": false,
          "temperature": true,
          "tool_call": true
        }
      }
    }
  },
  "model": "zed-cloud/claude-sonnet-4-6",
  "small_model": "zed-cloud/gpt-5-nano"
}
```

Then verify OpenCode can see the provider:

```sh
opencode models zed-cloud
```

Run a quick prompt:

```sh
opencode run --model zed-cloud/claude-sonnet-4-6 "Reply with exactly: ok"
```

Use a reasoning variant:

```sh
opencode run --model zed-cloud/gpt-5.5 --variant high "Reply with exactly: ok"
```

## Full Model Example

`opencode.example.jsonc` contains a fuller model map for the currently observed
Zed Cloud models. Copy the model entries you want into your OpenCode config.

After building, you can also print a model map from the live `/models` endpoint:

```sh
ZED_LLM_TOKEN="your-zed-llm-token" npm run models
```

## How It Maps Requests

OpenCode sends OpenAI-compatible chat requests to this provider. The provider
rewrites them for Zed Cloud:

- `claude-*` models use Zed's Anthropic payload shape.
- `gpt-*` models use Zed's OpenAI Responses payload shape.
- `gemini-*` models use Zed's Google payload shape.

Tool schemas are converted per provider. For example, Anthropic receives
`input_schema`, Gemini receives `functionDeclarations`, and GPT models receive
Responses-style `tools`.

## Development

```sh
npm install
npm run typecheck
npm run build
```

`dist/` is generated and intentionally not committed.
