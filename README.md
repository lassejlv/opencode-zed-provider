# OpenCode Zed Cloud Provider

Direct OpenCode provider package for Zed Cloud LLM endpoints.

It is not a proxy. OpenCode imports this package as an AI SDK provider, and the
provider calls `https://cloud.zed.dev/completions` directly with Zed's wrapped
payload format.

## Build

```sh
cd tools/opencode-zed-provider
npm install
npm run build
```

## Configure OpenCode

Set an LLM token:

```sh
export ZED_LLM_TOKEN="..."
```

Then add a provider to `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "zed-cloud": {
      "npm": "file:///Users/lassevestergaard/Documents/dev/zed/tools/opencode-zed-provider/dist/index.js",
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
          "tool_call": true
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

The `npm` value must be a `file://` URL to the built `dist/index.js` file.
OpenCode imports local provider URLs directly.

## Models

After building, you can print a model map for your OpenCode config:

```sh
ZED_LLM_TOKEN="..." npm run models
```

## Notes

- The provider maps OpenAI-compatible chat requests from OpenCode into Zed
  Cloud's OpenAI Responses-shaped `provider_request`.
- It supports streamed text and function/tool call deltas.
- If the Zed LLM token expires, mint a new one with Zed's
  `/client/llm_tokens` endpoint and update `ZED_LLM_TOKEN`.
