type ZedModel = {
  id: string | { [key: string]: unknown };
  display_name?: string;
  max_token_count?: number;
  max_output_tokens?: number;
  supports_images?: boolean;
  supports_thinking?: boolean;
  supports_tools?: boolean;
};

type ZedModelsResponse = {
  models: ZedModel[];
};

const token = process.env.ZED_LLM_TOKEN;

if (!token) {
  console.error("Missing ZED_LLM_TOKEN");
  process.exit(1);
}

const response = await fetch("https://cloud.zed.dev/models", {
  headers: {
    Authorization: `Bearer ${token}`,
    "x-zed-client-supports-x-ai": "true",
  },
});

if (!response.ok) {
  console.error(`Failed to fetch models: ${response.status} ${await response.text()}`);
  process.exit(1);
}

const body = (await response.json()) as ZedModelsResponse;
const models = Object.fromEntries(
  body.models.map((model) => {
    const id = typeof model.id === "string" ? model.id : String(model.id);
    return [
      id,
      {
        name: model.display_name ?? id,
        limit: {
          context: model.max_token_count,
          output: model.max_output_tokens,
        },
        attachment: model.supports_images ?? false,
        reasoning: model.supports_thinking ?? false,
        temperature: true,
        tool_call: model.supports_tools ?? false,
      },
    ];
  }),
);

console.log(JSON.stringify(models, null, 2));
