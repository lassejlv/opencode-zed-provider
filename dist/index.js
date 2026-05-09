import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
export function createZedCloud(settings = {}) {
    const providerName = settings.name ?? "zed-cloud";
    return createOpenAICompatible({
        name: providerName,
        baseURL: "https://cloud.zed.dev",
        apiKey: settings.apiKey ?? process.env.ZED_LLM_TOKEN ?? "unused",
        headers: settings.headers,
        fetch: createZedFetch({
            apiKey: settings.apiKey,
            baseURL: settings.baseURL,
            provider: settings.provider,
            headers: settings.headers,
        }),
    });
}
function createZedFetch(settings) {
    const zedFetch = async (_input, init) => {
        if (init?.method !== "POST" || init.body === undefined) {
            return fetch(_input, init);
        }
        const request = JSON.parse(String(init.body));
        const token = zedToken(settings);
        const provider = settings.provider ?? providerForModel(request.model);
        const zedURL = `${settings.baseURL ?? "https://cloud.zed.dev"}/completions`;
        const zedRequest = {
            thread_id: crypto.randomUUID(),
            prompt_id: crypto.randomUUID(),
            provider,
            model: request.model,
            provider_request: toProviderRequest(provider, request),
        };
        const response = await fetch(zedURL, {
            method: "POST",
            signal: init.signal,
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
                "x-zed-client-supports-status-messages": "true",
                "x-zed-client-supports-stream-ended-request-completion-status": "true",
                ...settings.headers,
            },
            body: JSON.stringify(zedRequest),
        });
        if (!response.ok)
            return response;
        if (request.stream === false) {
            return nonStreamingChatResponse(response, request.model, provider);
        }
        return streamingChatResponse(response, request.model, provider);
    };
    return zedFetch;
}
function zedToken(settings) {
    const token = settings.apiKey ?? process.env.ZED_LLM_TOKEN;
    if (!token || token === "unused") {
        throw new Error("Missing Zed LLM token. Set ZED_LLM_TOKEN or provider.options.apiKey.");
    }
    return token;
}
function providerForModel(model) {
    if (model.startsWith("claude-"))
        return "anthropic";
    if (model.startsWith("gemini-"))
        return "google";
    if (model.startsWith("grok-"))
        return "x_ai";
    return "open_ai";
}
function toProviderRequest(provider, request) {
    if (provider === "anthropic")
        return toAnthropicRequest(request);
    if (provider === "google")
        return toGoogleRequest(request);
    return toResponsesRequest(request);
}
function toResponsesRequest(request) {
    const effort = reasoningEffort(request);
    return {
        model: request.model,
        input: toResponsesInput(request.messages ?? []),
        stream: request.stream !== false,
        temperature: request.temperature,
        top_p: request.top_p,
        max_output_tokens: request.max_completion_tokens ?? request.max_tokens,
        tools: request.tools?.map((tool) => ({
            type: "function",
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters,
        })),
        tool_choice: toResponsesToolChoice(request.tool_choice),
        reasoning: request.reasoning ?? (effort ? { effort, summary: "auto" } : undefined),
    };
}
function toAnthropicRequest(request) {
    const effort = reasoningEffort(request);
    const system = request.messages
        ?.filter((message) => message.role === "system")
        .map((message) => contentToText(message.content))
        .filter((content) => content.length > 0)
        .join("\n\n");
    return {
        model: request.model,
        max_tokens: request.max_completion_tokens ?? request.max_tokens ?? 8192,
        messages: toAnthropicMessages(request.messages ?? []),
        tools: request.tools?.map((tool) => ({
            name: tool.function.name,
            description: tool.function.description ?? "",
            input_schema: tool.function.parameters ?? { type: "object", properties: {} },
        })),
        tool_choice: toAnthropicToolChoice(request.tool_choice),
        thinking: effort ? { type: "adaptive", display: "summarized" } : undefined,
        output_config: effort ? { effort } : undefined,
        system: system && system.length > 0 ? system : undefined,
        temperature: request.temperature,
        top_p: request.top_p,
    };
}
function reasoningEffort(request) {
    if (request.reasoning_effort)
        return request.reasoning_effort;
    if (request.reasoningEffort)
        return request.reasoningEffort;
    if (typeof request.reasoning === "object" &&
        request.reasoning !== null &&
        "effort" in request.reasoning &&
        typeof request.reasoning.effort === "string") {
        return request.reasoning.effort;
    }
    return undefined;
}
function toAnthropicMessages(messages) {
    return messages.flatMap((message) => {
        if (message.role === "system")
            return [];
        if (message.role === "tool") {
            return [
                {
                    role: "user",
                    content: [
                        {
                            type: "tool_result",
                            tool_use_id: message.tool_call_id ?? "",
                            is_error: false,
                            content: contentToText(message.content),
                        },
                    ],
                },
            ];
        }
        if (message.role === "assistant") {
            const content = [];
            const text = contentToText(message.content);
            if (text.length > 0)
                content.push({ type: "text", text });
            for (const toolCall of message.tool_calls ?? []) {
                content.push({
                    type: "tool_use",
                    id: toolCall.id,
                    name: toolCall.function.name,
                    input: parseToolInput(toolCall.function.arguments),
                });
            }
            if (content.length === 0)
                return [];
            return [{ role: "assistant", content }];
        }
        const content = contentToAnthropicContent(message.content);
        if (content.length === 0)
            return [];
        return [{ role: "user", content }];
    });
}
function contentToAnthropicContent(content) {
    if (typeof content === "string" || content == null) {
        return content && content.length > 0 ? [{ type: "text", text: content }] : [];
    }
    return content.flatMap((part) => {
        if (part.type === "text" && typeof part.text === "string" && part.text.length > 0) {
            return [{ type: "text", text: part.text }];
        }
        if (part.type === "image_url") {
            const imageURL = typeof part.image_url === "string"
                ? part.image_url
                : typeof part.image_url === "object" &&
                    part.image_url !== null &&
                    "url" in part.image_url &&
                    typeof part.image_url.url === "string"
                    ? part.image_url.url
                    : undefined;
            const source = imageURL ? dataURLToAnthropicSource(imageURL) : undefined;
            return source ? [{ type: "image", source }] : [];
        }
        return [];
    });
}
function dataURLToAnthropicSource(url) {
    const match = /^data:([^;]+);base64,(.+)$/u.exec(url);
    if (!match)
        return undefined;
    return {
        type: "base64",
        media_type: match[1],
        data: match[2],
    };
}
function parseToolInput(input) {
    try {
        return JSON.parse(input);
    }
    catch {
        return {};
    }
}
function toAnthropicToolChoice(toolChoice) {
    if (toolChoice == null)
        return undefined;
    if (toolChoice === "auto")
        return { type: "auto" };
    if (toolChoice === "none")
        return { type: "none" };
    if (toolChoice === "required")
        return { type: "any" };
    if (typeof toolChoice === "object" &&
        toolChoice !== null &&
        "type" in toolChoice &&
        toolChoice.type === "function" &&
        "function" in toolChoice &&
        typeof toolChoice.function === "object" &&
        toolChoice.function !== null &&
        "name" in toolChoice.function &&
        typeof toolChoice.function.name === "string") {
        return { type: "tool", name: toolChoice.function.name };
    }
    return undefined;
}
function toGoogleRequest(request) {
    const systemParts = request.messages
        ?.filter((message) => message.role === "system")
        .flatMap((message) => contentToGoogleParts(message.content));
    return {
        model: request.model,
        contents: toGoogleContents(request.messages ?? []),
        systemInstruction: systemParts && systemParts.length > 0 ? { parts: systemParts } : undefined,
        generationConfig: {
            candidateCount: 1,
            maxOutputTokens: request.max_completion_tokens ?? request.max_tokens,
            temperature: request.temperature ?? 1.0,
            topP: request.top_p,
        },
        tools: request.tools && request.tools.length > 0
            ? [
                {
                    functionDeclarations: request.tools.map((tool) => ({
                        name: tool.function.name,
                        description: tool.function.description ?? "",
                        parameters: tool.function.parameters ?? { type: "object", properties: {} },
                    })),
                },
            ]
            : undefined,
        toolConfig: request.tool_choice
            ? {
                functionCallingConfig: {
                    mode: toGoogleFunctionCallingMode(request.tool_choice),
                },
            }
            : undefined,
    };
}
function toGoogleContents(messages) {
    return messages.flatMap((message) => {
        if (message.role === "system")
            return [];
        if (message.role === "tool") {
            return [
                {
                    role: "user",
                    parts: [
                        {
                            functionResponse: {
                                name: message.tool_call_id ?? "tool",
                                response: {
                                    output: contentToText(message.content),
                                },
                            },
                        },
                    ],
                },
            ];
        }
        if (message.role === "assistant") {
            const parts = [
                ...contentToGoogleParts(message.content),
                ...(message.tool_calls ?? []).map((toolCall) => ({
                    functionCall: {
                        name: toolCall.function.name,
                        args: parseToolInput(toolCall.function.arguments),
                    },
                })),
            ];
            return parts.length > 0 ? [{ role: "model", parts }] : [];
        }
        const parts = contentToGoogleParts(message.content);
        return parts.length > 0 ? [{ role: "user", parts }] : [];
    });
}
function contentToGoogleParts(content) {
    if (typeof content === "string" || content == null) {
        return content && content.length > 0 ? [{ text: content }] : [];
    }
    return content.flatMap((part) => {
        if (part.type === "text" && typeof part.text === "string" && part.text.length > 0) {
            return [{ text: part.text }];
        }
        if (part.type === "image_url") {
            const imageURL = typeof part.image_url === "string"
                ? part.image_url
                : typeof part.image_url === "object" &&
                    part.image_url !== null &&
                    "url" in part.image_url &&
                    typeof part.image_url.url === "string"
                    ? part.image_url.url
                    : undefined;
            const source = imageURL ? dataURLToAnthropicSource(imageURL) : undefined;
            return source
                ? [
                    {
                        inlineData: {
                            mimeType: source.media_type,
                            data: source.data,
                        },
                    },
                ]
                : [];
        }
        return [];
    });
}
function toGoogleFunctionCallingMode(toolChoice) {
    if (toolChoice === "none")
        return "none";
    if (toolChoice === "required")
        return "any";
    return "auto";
}
function toResponsesInput(messages) {
    const input = [];
    for (const message of messages) {
        if (message.role === "tool") {
            input.push({
                type: "function_call_output",
                call_id: message.tool_call_id ?? "",
                output: contentToText(message.content),
            });
            continue;
        }
        if (message.role === "assistant") {
            const text = contentToText(message.content);
            if (text.length > 0) {
                input.push({
                    type: "message",
                    role: "assistant",
                    content: [{ type: "output_text", text, annotations: [] }],
                });
            }
            for (const toolCall of message.tool_calls ?? []) {
                input.push({
                    type: "function_call",
                    call_id: toolCall.id,
                    name: toolCall.function.name,
                    arguments: toolCall.function.arguments,
                });
            }
            continue;
        }
        input.push({
            type: "message",
            role: message.role,
            content: contentToResponsesContent(message.content),
        });
    }
    return input;
}
function contentToResponsesContent(content) {
    if (typeof content === "string" || content == null) {
        return [{ type: "input_text", text: content ?? "" }];
    }
    return content.flatMap((part) => {
        if (part.type === "text" && typeof part.text === "string") {
            return [{ type: "input_text", text: part.text }];
        }
        if (part.type === "image_url") {
            const imageURL = typeof part.image_url === "string"
                ? part.image_url
                : typeof part.image_url === "object" &&
                    part.image_url !== null &&
                    "url" in part.image_url &&
                    typeof part.image_url.url === "string"
                    ? part.image_url.url
                    : undefined;
            if (!imageURL)
                return [];
            return [{ type: "input_image", image_url: imageURL }];
        }
        return [];
    });
}
function contentToText(content) {
    if (typeof content === "string")
        return content;
    if (content == null)
        return "";
    return content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
}
function toResponsesToolChoice(toolChoice) {
    if (toolChoice == null)
        return undefined;
    if (toolChoice === "auto" || toolChoice === "none" || toolChoice === "required")
        return toolChoice;
    if (typeof toolChoice === "object" &&
        toolChoice !== null &&
        "type" in toolChoice &&
        toolChoice.type === "function" &&
        "function" in toolChoice) {
        return toolChoice;
    }
    return undefined;
}
async function streamingChatResponse(response, model, provider) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const reader = response.body?.getReader();
    if (!reader) {
        return new Response(null, { status: 502, statusText: "Zed Cloud response had no body" });
    }
    const id = `chatcmpl-zed-${crypto.randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    const toolCalls = new Map();
    let nextToolCallIndex = 0;
    let emittedToolCall = false;
    const stream = new ReadableStream({
        async start(controller) {
            let buffer = "";
            function send(data) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            }
            function sendDone() {
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            }
            function sendChunk(delta, finishReason = null) {
                send({
                    id,
                    object: "chat.completion.chunk",
                    created,
                    model,
                    choices: [{ index: 0, delta, finish_reason: finishReason }],
                });
            }
            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done)
                        break;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split(/\r?\n/);
                    buffer = lines.pop() ?? "";
                    for (const line of lines) {
                        const event = provider === "anthropic"
                            ? parseAnthropicLine(line)
                            : provider === "google"
                                ? parseGoogleLine(line)
                                : parseZedLine(line);
                        if (!event)
                            continue;
                        if (provider === "anthropic") {
                            const handled = handleAnthropicStreamingEvent({
                                event: event,
                                sendChunk,
                                sendDone,
                                controller,
                                toolCalls,
                                nextToolCallIndex: () => nextToolCallIndex++,
                            });
                            if (handled === "closed")
                                return;
                            if (handled === "handled")
                                continue;
                        }
                        if (provider === "google") {
                            const handled = handleGoogleStreamingEvent({
                                event: event,
                                sendChunk,
                                sendDone,
                                controller,
                                toolCalls,
                                nextToolCallIndex: () => nextToolCallIndex++,
                            });
                            if (handled === "closed")
                                return;
                            continue;
                        }
                        const responseEvent = event;
                        switch (responseEvent.type) {
                            case "response.output_text.delta":
                                if (responseEvent.delta)
                                    sendChunk({ content: responseEvent.delta });
                                break;
                            case "response.output_item.added":
                                if (responseEvent.item?.type === "function_call") {
                                    const key = responseEvent.item.id ?? responseEvent.item.call_id ?? String(responseEvent.output_index ?? nextToolCallIndex);
                                    const state = {
                                        index: nextToolCallIndex++,
                                        id: responseEvent.item.call_id ?? key,
                                        name: responseEvent.item.name,
                                        arguments: responseEvent.item.arguments ?? "",
                                    };
                                    toolCalls.set(key, state);
                                    emittedToolCall = true;
                                    sendChunk({
                                        tool_calls: [
                                            {
                                                index: state.index,
                                                id: state.id,
                                                type: "function",
                                                function: { name: state.name, arguments: "" },
                                            },
                                        ],
                                    });
                                }
                                break;
                            case "response.function_call_arguments.delta": {
                                const state = toolCalls.get(responseEvent.item_id ?? "");
                                if (state && responseEvent.delta) {
                                    state.arguments += responseEvent.delta;
                                    sendChunk({
                                        tool_calls: [
                                            {
                                                index: state.index,
                                                function: { arguments: responseEvent.delta },
                                            },
                                        ],
                                    });
                                }
                                break;
                            }
                            case "response.function_call_arguments.done": {
                                const state = toolCalls.get(responseEvent.item_id ?? "");
                                if (state && responseEvent.arguments && state.arguments.length === 0) {
                                    state.arguments = responseEvent.arguments;
                                    sendChunk({
                                        tool_calls: [
                                            {
                                                index: state.index,
                                                function: { arguments: responseEvent.arguments },
                                            },
                                        ],
                                    });
                                }
                                break;
                            }
                            case "response.completed":
                                sendChunk({}, emittedToolCall ? "tool_calls" : "stop");
                                sendDone();
                                controller.close();
                                return;
                            case "response.incomplete":
                                sendChunk({}, "length");
                                sendDone();
                                controller.close();
                                return;
                            case "response.failed":
                                throw new Error("Zed Cloud reported response.failed");
                        }
                    }
                }
                sendChunk({}, emittedToolCall ? "tool_calls" : "stop");
                sendDone();
                controller.close();
            }
            catch (error) {
                controller.error(error);
            }
            finally {
                reader.releaseLock();
            }
        },
        async cancel(reason) {
            await reader.cancel(reason);
        },
    });
    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
}
function handleAnthropicStreamingEvent(input) {
    const { event, sendChunk, sendDone, controller, toolCalls, nextToolCallIndex } = input;
    switch (event.type) {
        case "content_block_start":
            if (event.content_block?.type === "text" && event.content_block.text) {
                sendChunk({ content: event.content_block.text });
                return "handled";
            }
            if (event.content_block?.type === "tool_use") {
                const key = String(event.index ?? nextToolCallIndex());
                const state = {
                    index: Number(key),
                    id: event.content_block.id ?? `toolu_zed_${crypto.randomUUID()}`,
                    name: event.content_block.name,
                    arguments: event.content_block.input ? JSON.stringify(event.content_block.input) : "",
                };
                toolCalls.set(key, state);
                sendChunk({
                    tool_calls: [
                        {
                            index: state.index,
                            id: state.id,
                            type: "function",
                            function: { name: state.name, arguments: state.arguments },
                        },
                    ],
                });
                return "handled";
            }
            return "handled";
        case "content_block_delta":
            if (event.delta?.type === "text_delta" && event.delta.text) {
                sendChunk({ content: event.delta.text });
                return "handled";
            }
            if (event.delta?.type === "input_json_delta") {
                const state = toolCalls.get(String(event.index ?? ""));
                if (state && event.delta.partial_json) {
                    state.arguments += event.delta.partial_json;
                    sendChunk({
                        tool_calls: [
                            {
                                index: state.index,
                                function: { arguments: event.delta.partial_json },
                            },
                        ],
                    });
                }
                return "handled";
            }
            return "handled";
        case "message_delta":
            return "handled";
        case "message_stop":
            sendChunk({}, toolCalls.size > 0 ? "tool_calls" : "stop");
            sendDone();
            controller.close();
            return "closed";
        case "error":
            throw new Error(event.error?.message ?? "Zed Cloud Anthropic stream returned an error");
    }
    return "unhandled";
}
function handleGoogleStreamingEvent(input) {
    const { event, sendChunk, sendDone, controller, toolCalls, nextToolCallIndex } = input;
    if (event.promptFeedback?.blockReason) {
        sendChunk({}, "content_filter");
        sendDone();
        controller.close();
        return "closed";
    }
    let finishReason = null;
    for (const candidate of event.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
            if (part.text)
                sendChunk({ content: part.text });
            if (part.functionCall?.name) {
                const index = nextToolCallIndex();
                const id = `call_zed_${crypto.randomUUID()}`;
                const args = JSON.stringify(part.functionCall.args ?? {});
                toolCalls.set(String(index), {
                    index,
                    id,
                    name: part.functionCall.name,
                    arguments: args,
                });
                sendChunk({
                    tool_calls: [
                        {
                            index,
                            id,
                            type: "function",
                            function: {
                                name: part.functionCall.name,
                                arguments: args,
                            },
                        },
                    ],
                });
            }
        }
        finishReason = googleFinishReason(candidate.finishReason, toolCalls.size > 0);
    }
    if (finishReason) {
        sendChunk({}, finishReason);
        sendDone();
        controller.close();
        return "closed";
    }
    return "handled";
}
async function nonStreamingChatResponse(response, model, provider) {
    const textParts = [];
    const toolCalls = new Map();
    let nextToolCallIndex = 0;
    for (const line of (await response.text()).split(/\r?\n/)) {
        const event = provider === "anthropic"
            ? parseAnthropicLine(line)
            : provider === "google"
                ? parseGoogleLine(line)
                : parseZedLine(line);
        if (!event)
            continue;
        if (provider === "anthropic") {
            collectAnthropicEvent(event, textParts, toolCalls, () => nextToolCallIndex++);
            continue;
        }
        if (provider === "google") {
            collectGoogleEvent(event, textParts, toolCalls, () => nextToolCallIndex++);
            continue;
        }
        const responseEvent = event;
        if (responseEvent.type === "response.output_text.delta" && responseEvent.delta) {
            textParts.push(responseEvent.delta);
        }
        else if (responseEvent.type === "response.output_item.added" && responseEvent.item?.type === "function_call") {
            const key = responseEvent.item.id ?? responseEvent.item.call_id ?? String(responseEvent.output_index ?? nextToolCallIndex);
            toolCalls.set(key, {
                index: nextToolCallIndex++,
                id: responseEvent.item.call_id ?? key,
                name: responseEvent.item.name,
                arguments: responseEvent.item.arguments ?? "",
            });
        }
        else if (responseEvent.type === "response.function_call_arguments.delta") {
            const state = toolCalls.get(responseEvent.item_id ?? "");
            if (state && responseEvent.delta)
                state.arguments += responseEvent.delta;
        }
        else if (responseEvent.type === "response.function_call_arguments.done") {
            const state = toolCalls.get(responseEvent.item_id ?? "");
            if (state && responseEvent.arguments)
                state.arguments = responseEvent.arguments;
        }
    }
    const calls = Array.from(toolCalls.values());
    return Response.json({
        id: `chatcmpl-zed-${crypto.randomUUID()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
            {
                index: 0,
                message: {
                    role: "assistant",
                    content: textParts.join(""),
                    tool_calls: calls.map((call) => ({
                        id: call.id,
                        type: "function",
                        function: {
                            name: call.name,
                            arguments: call.arguments,
                        },
                    })),
                },
                finish_reason: calls.length > 0 ? "tool_calls" : "stop",
            },
        ],
    });
}
function collectGoogleEvent(event, textParts, toolCalls, nextToolCallIndex) {
    for (const candidate of event.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
            if (part.text)
                textParts.push(part.text);
            if (part.functionCall?.name) {
                const index = nextToolCallIndex();
                toolCalls.set(String(index), {
                    index,
                    id: `call_zed_${crypto.randomUUID()}`,
                    name: part.functionCall.name,
                    arguments: JSON.stringify(part.functionCall.args ?? {}),
                });
            }
        }
    }
}
function googleFinishReason(finishReason, hasToolCalls) {
    if (hasToolCalls)
        return "tool_calls";
    switch (finishReason) {
        case "STOP":
            return "stop";
        case "MAX_TOKENS":
            return "length";
        case "SAFETY":
        case "RECITATION":
            return "content_filter";
        case undefined:
            return null;
        default:
            return "stop";
    }
}
function collectAnthropicEvent(event, textParts, toolCalls, nextToolCallIndex) {
    if (event.type === "content_block_start" && event.content_block?.type === "text" && event.content_block.text) {
        textParts.push(event.content_block.text);
    }
    else if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
        textParts.push(event.delta.text);
    }
    else if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
        const key = String(event.index ?? nextToolCallIndex());
        toolCalls.set(key, {
            index: Number(key),
            id: event.content_block.id ?? `toolu_zed_${crypto.randomUUID()}`,
            name: event.content_block.name,
            arguments: event.content_block.input ? JSON.stringify(event.content_block.input) : "",
        });
    }
    else if (event.type === "content_block_delta" && event.delta?.type === "input_json_delta") {
        const state = toolCalls.get(String(event.index ?? ""));
        if (state && event.delta.partial_json)
            state.arguments += event.delta.partial_json;
    }
    else if (event.type === "error") {
        throw new Error(event.error?.message ?? "Zed Cloud Anthropic stream returned an error");
    }
}
function parseZedLine(line) {
    const trimmed = line.trim();
    if (!trimmed)
        return undefined;
    const parsed = JSON.parse(trimmed);
    const event = parsed.event ?? (typeof parsed.type === "string" ? parsed : undefined);
    return event?.type ? event : undefined;
}
function parseAnthropicLine(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("event:"))
        return undefined;
    const payload = trimmed.startsWith("data:") ? trimmed.slice("data:".length).trim() : trimmed;
    if (!payload || payload === "[DONE]")
        return undefined;
    const parsed = JSON.parse(payload);
    const event = "event" in parsed && parsed.event ? parsed.event : parsed;
    return event.type ? event : undefined;
}
function parseGoogleLine(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("event:"))
        return undefined;
    const payload = trimmed.startsWith("data:") ? trimmed.slice("data:".length).trim() : trimmed;
    if (!payload || payload === "[DONE]")
        return undefined;
    const parsed = JSON.parse(payload);
    if ("event" in parsed && parsed.event)
        return parsed.event;
    return parsed;
}
export default createZedCloud;
//# sourceMappingURL=index.js.map