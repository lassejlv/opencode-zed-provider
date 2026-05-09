type ProviderSettings = {
    name?: string;
    apiKey?: string;
    baseURL?: string;
    provider?: ZedProvider;
    headers?: Record<string, string>;
};
type ZedProvider = "open_ai" | "anthropic" | "google" | "x_ai";
export declare function createZedCloud(settings?: ProviderSettings): import("@ai-sdk/openai-compatible").OpenAICompatibleProvider<string, string, string, string>;
export default createZedCloud;
