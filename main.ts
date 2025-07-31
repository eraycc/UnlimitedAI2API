import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

// 全局鉴权token环境变量，默认为sk-default
const AUTH_TOKEN = Deno.env.get("AUTH_TOKEN") || "sk-default";

// 随机正常设备User-Agent列表
const USER_AGENTS = [
  "Mozilla/5.0 (Linux; Android 14; V2118A Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.6998.135 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
];

// 获取随机User-Agent
function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// 获取JWT Token
async function getJwtToken(): Promise<string> {
  const userAgent = getRandomUserAgent();
  const response = await fetch("https://app.unlimitedai.chat/api/token", {
    headers: {
      "User-Agent": userAgent,
      "Referer": "https://app.unlimitedai.chat/chat/",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get JWT token: ${response.statusText}`);
  }

  const data = await response.json();
  return data.token;
}

// 处理聊天请求
async function handleChatRequest(request: Request): Promise<Response> {
  // 鉴权
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const token = authHeader.substring(7);
  if (token !== AUTH_TOKEN) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 解析请求体
  let requestBody;
  try {
    requestBody = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { messages, stream = false } = requestBody;

  // 获取JWT Token
  let jwtToken;
  try {
    jwtToken = await getJwtToken();
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Failed to get JWT token", details: e.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // 构造转发请求
  const userAgent = getRandomUserAgent();
  const requestId = crypto.randomUUID();

  const payload = {
    messages,
    id: requestId,
    selectedChatModel: "chat-model-reasoning",
  };

  try {
    const targetResponse = await fetch("https://app.unlimitedai.chat/api/chat", {
      method: "POST",
      headers: {
        "User-Agent": userAgent,
        "Content-Type": "application/json",
        "X-API-Token": jwtToken,
        "Referer": "https://app.unlimitedai.chat/",
      },
      body: JSON.stringify(payload),
    });

    if (!targetResponse.ok) {
      return new Response(
        JSON.stringify({
          error: "Target API request failed",
          status: targetResponse.status,
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const targetResponseText = await targetResponse.text();
    const lines = targetResponseText.trim().split("\n");

    // 解析目标API响应
    let messageContent = "";
    let finishReason = "stop";
    let promptTokens = 0;
    let completionTokens = 0;

    for (const line of lines) {
      if (line.startsWith('0:"')) {
        messageContent += line.substring(3, line.length - 1);
      } else if (line.startsWith('e:') || line.startsWith('d:')) {
        const jsonStr = line.substring(2);
        try {
          const data = JSON.parse(jsonStr);
          if (data.finishReason) finishReason = data.finishReason;
          if (data.usage) {
            promptTokens = data.usage.promptTokens || 0;
            completionTokens = data.usage.completionTokens || 0;
          }
        } catch (e) {
          console.error("Failed to parse finish reason:", e);
        }
      }
    }

    // 构造OpenAI格式响应
    const responseId = `chatcmpl-${crypto.randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);

    if (stream) {
      // 流式响应
      const stream = new ReadableStream({
        async start(controller) {
          // 发送消息内容
          const deltaContent = messageContent.split("");
          for (const char of deltaContent) {
            const chunk = {
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model: "UnlimitedAI",
              choices: [
                {
                  index: 0,
                  delta: { content: char },
                  finish_reason: null,
                },
              ],
            };
            controller.enqueue(`data: ${JSON.stringify(chunk)}\n\n`);
            await new Promise((r) => setTimeout(r, 10)); // 添加小延迟模拟流
          }

          // 发送结束消息
          const endChunk = {
            id: responseId,
            object: "chat.completion.chunk",
            created,
            model: "UnlimitedAI",
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: finishReason,
              },
            ],
          };
          controller.enqueue(`data: ${JSON.stringify(endChunk)}\n\n`);
          controller.enqueue("data: [DONE]\n\n");
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } else {
      // 非流式响应
      const response = {
        id: responseId,
        object: "chat.completion",
        created,
        model: "UnlimitedAI",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: messageContent,
            },
            finish_reason: finishReason,
          },
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      };

      return new Response(JSON.stringify(response), {
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Internal server error", details: e.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

// 处理模型列表请求
function handleModelsRequest(): Response {
  const response = {
    object: "list",
    data: [
      {
        id: "UnlimitedAI",
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: "UnlimitedAI",
      },
    ],
  };

  return new Response(JSON.stringify(response), {
    headers: { "Content-Type": "application/json" },
  });
}

// 主请求处理器
async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);

  try {
    if (url.pathname === "/v1/models") {
      return handleModelsRequest();
    } else if (url.pathname === "/v1/chat/completions") {
      return await handleChatRequest(request);
    } else {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Internal server error", details: e.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

Deno.serve(handler);
