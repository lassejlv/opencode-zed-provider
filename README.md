# OpenCode Zed Cloud Provider

Use Zed Cloud models from OpenCode without running a proxy.

This package is an OpenCode-compatible AI SDK provider. OpenCode imports the
built provider directly, sends it OpenAI-compatible chat requests, and the
provider calls Zed Cloud's `https://cloud.zed.dev/completions` endpoint using
Zed's wrapped `provider_request` format.

## Features

- Direct requests to Zed Cloud. No local HTTP proxy required.
- Claude, GPT, Gemini, and Grok-style model routing based on model id.
- Streaming and non-streaming chat completions.
- Tool calls mapped across Anthropic, OpenAI Responses, and Google payloads.
- Image input support for models that accept attachments.
- Reasoning effort variants for supported Claude and GPT models.
- Automatic LLM-token refresh from explicit credentials or macOS Keychain.
- Model-map generation from `https://cloud.zed.dev/models`.

## Requirements

- Node.js 20 or newer.
- npm.
- OpenCode.
- A signed-in Zed account with access to Zed Cloud LLMs.

## Quick Start

Clone, install, and build the provider:

```sh
git clone https://github.com/lassejlv/opencode-zed-provider.git
cd opencode-zed-provider
npm install
npm run build
```

Build output is written to `dist/`. OpenCode imports `dist/index.js` directly.

Then add the provider to your OpenCode config, usually at:

```sh
~/.config/opencode/opencode.jsonc
```

Use an absolute `file://` URL that points to your local build output:

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

Verify OpenCode can see the provider:

```sh
opencode models zed-cloud
```

Run a smoke test:

```sh
opencode run --model zed-cloud/claude-sonnet-4-6 "Reply with exactly: ok"
```

Use a reasoning variant:

```sh
opencode run --model zed-cloud/gpt-5.5 --variant high "Reply with exactly: ok"
```

## Authentication

Zed Cloud completions require a short-lived Zed LLM token. You can provide that
token directly, or let the provider refresh it from your Zed account credentials.

### Option 1: Use A Minted LLM Token

If you already have a Zed LLM token, export it in the shell that launches
OpenCode:

```sh
export ZED_LLM_TOKEN="your-zed-llm-token"
```

This is the simplest setup, but the token is short-lived. If requests begin
returning `401 Unauthorized`, mint a new token or configure automatic refresh.

### Option 2: Enable Automatic Refresh

Automatic refresh requires your Zed account user id and account access token:

```sh
export ZED_USER_ID="your-numeric-user-id"
export ZED_ACCESS_TOKEN="your-zed-account-access-token"
export ZED_LLM_TOKEN="optional-initial-zed-llm-token"
```

When `ZED_LLM_TOKEN` expires, the provider mints a fresh token, keeps it in
memory, and retries the failed request once.

`ZED_ACCESS_TOKEN` must be the Zed account access token. It must not be the JSON
response from `/client/llm_tokens`.

### Finding Zed Credentials On macOS

If you are signed in to Zed on macOS, Zed stores account credentials in
Keychain. Open Keychain Access, search for `zed.dev`, and inspect the Internet
password entry:

- The Account field is your numeric Zed user id.
- The password value is your Zed account access token.

If `ZED_USER_ID` and `ZED_ACCESS_TOKEN` are not set, this provider also tries to
read those credentials from macOS Keychain automatically.

### Minting An LLM Token Manually

You can mint an LLM token from your account credentials with:

```sh
curl https://cloud.zed.dev/client/llm_tokens \
  -X POST \
  -H "Authorization: ${ZED_USER_ID} ${ZED_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"organization_id":null}'
```

The response includes a `token` field:

```json
{
  "version": 2,
  "id": "client_token_...",
  "token": "..."
}
```

Export the `token` value as `ZED_LLM_TOKEN`.

Treat both the account access token and LLM token like passwords. Do not commit
them, paste them into logs, or share them.

## Models

`opencode.example.jsonc` contains a fuller model map for the Zed Cloud models
observed when this provider was authored. Copy the model entries you want into
your OpenCode config.

After building, you can also generate a fresh model map from Zed Cloud:

```sh
ZED_LLM_TOKEN="your-zed-llm-token" npm run models
```

The command prints JSON that can be copied into the `models` section of your
OpenCode provider config.

## How Requests Are Mapped

OpenCode sends OpenAI-compatible chat requests to this provider. The provider
chooses a Zed provider from the model id and rewrites the request:

- `claude-*` models use Zed's Anthropic payload shape.
- `gemini-*` models use Zed's Google payload shape.
- `grok-*` models use Zed's xAI payload shape.
- Other models use Zed's OpenAI Responses payload shape.

Tool schemas are converted for each backend:

- Anthropic receives `input_schema` tools.
- Gemini receives `functionDeclarations`.
- GPT and xAI-style models receive Responses-style `tools`.

Response streams are converted back into OpenAI-compatible chat completion
chunks so OpenCode can consume text, finish reasons, and tool calls normally.

## Development

Install dependencies:

```sh
npm install
```

Type-check the source:

```sh
npm run typecheck
```

Build the provider:

```sh
npm run build
```

Generate a live model map:

```sh
ZED_LLM_TOKEN="your-zed-llm-token" npm run models
```

`dist/` is generated build output and is intentionally ignored by git.

## Troubleshooting

If OpenCode cannot load the provider, confirm that `npm run build` has created
`dist/index.js` and that your OpenCode config uses an absolute `file://` URL.

If requests fail with `Missing Zed LLM token`, set `ZED_LLM_TOKEN` or configure
`ZED_USER_ID` and `ZED_ACCESS_TOKEN` so the provider can mint a token.

If requests fail with `401 Unauthorized`, your LLM token may have expired. Set
fresh credentials or rely on automatic refresh from environment variables or
macOS Keychain.

If a model does not appear in `opencode models zed-cloud`, add it to the
provider's `models` config or regenerate the model map with `npm run models`.

## Security Notes

- Do not commit `ZED_LLM_TOKEN`, `ZED_USER_ID`, or `ZED_ACCESS_TOKEN`.
- Prefer environment variables or Keychain-backed refresh over hard-coded tokens.
- Remember that `ZED_ACCESS_TOKEN` is a long-lived account credential.
- Rotate credentials if they are exposed in shell history, logs, or config files.
