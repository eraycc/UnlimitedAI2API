import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

// 全局鉴权token环境变量，默认为sk-default
const AUTH_TOKEN = Deno.env.get("AUTH_TOKEN") || "sk-your-key";

// 随机正常设备User-Agent列表
const USER_AGENTS = [
  "Mozilla/5.0 (Linux; Android 14; V2118A Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.6998.135 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
];

// 生成UUID
function generateUUID(): string {
  return crypto.randomUUID();
}

// 获取随机User-Agent
function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// 获取JWT Token
async function getJwtToken(): Promise<string> {
  const userAgent = getRandomUserAgent();
  console.log(`Fetching JWT token with User-Agent: ${userAgent}`);
  const response = await fetch("https://app.unlimitedai.chat/api/token", {
    headers: {
      "User-Agent": userAgent,
      "Referer": "https://app.unlimitedai.chat/",
    },
  });

  if (!response.ok) {
    console.error(`Failed to get JWT token: ${response.status} ${response.statusText}`);
    throw new Error(`Failed to get JWT token: ${response.statusText}`);
  }

  const data = await response.json();
  console.log(`Successfully obtained JWT token`);
  return data.token;
}

// 处理聊天请求
async function handleChatRequest(request: Request): Promise<Response> {
  // 鉴权
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.error("Unauthorized request - missing or invalid Authorization header");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const token = authHeader.substring(7);
  if (token !== AUTH_TOKEN) {
    console.error("Forbidden request - invalid token");
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 解析请求体
  let requestBody;
  try {
    requestBody = await request.json();
    console.log("Received request body:", JSON.stringify(requestBody, null, 2));
  } catch (e) {
    console.error("Invalid request body:", e);
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { messages, stream = false } = requestBody;
  console.log(`Processing chat request with ${messages.length} messages, stream: ${stream}`);

  // 获取JWT Token
  let jwtToken;
  try {
    jwtToken = await getJwtToken();
  } catch (e) {
    console.error("Failed to get JWT token:", e);
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
  const requestId = generateUUID();

  const payload = {
    messages,
    id: requestId,
    selectedChatModel: "chat-model-reasoning",
  };

  console.log("Forwarding request to target API with payload:", JSON.stringify(payload, null, 2));
  console.log("Using JWT token:", jwtToken);

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
      console.error(`Target API request failed: ${targetResponse.status} ${targetResponse.statusText}`);
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
    console.log("Received target API response:", targetResponseText);

    const lines = targetResponseText.trim().split("\n");

    // 解析目标API响应
    let messageId = "";
    const contentChunks: string[] = [];
    let finishReason = "stop";
    let promptTokens = 0;
    let completionTokens = 0;

    for (const line of lines) {
      if (line.startsWith('f:')) {
        const jsonStr = line.substring(2);
        try {
          const data = JSON.parse(jsonStr);
          messageId = data.messageId || "";
          console.log("Extracted message ID:", messageId);
        } catch (e) {
          console.error("Failed to parse message ID:", e);
        }
      } else if (line.startsWith('0:"')) {
        let content = line.substring(3, line.length - 1);
        
        // 如果是最后一个内容块且以\n结尾，则移除\n
        if (line === lines.findLast(l => l.startsWith('0:"')) && content.endsWith('\\n')) {
          content = content.slice(0, -2);
          console.log("Removed trailing \\n from last content chunk");
        }
        
        contentChunks.push(content);
        console.log("Found content chunk:", content);
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

    const fullContent = contentChunks.join("");
    console.log("Full message content:", fullContent);

    // 构造OpenAI格式响应
    const responseId = `chatcmpl-${generateUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    const fingerprint = `fp_${Math.random().toString(16).slice(2)}`;

    if (stream) {
      // 流式响应 - 修复版本
      console.log("Returning stream response with", contentChunks.length, "chunks");
      
      const stream = new ReadableStream({
        async start(controller) {
          try {
            // 1. 首先发送角色设置块
            const initialChunk = {
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model: "UnlimitedAI",
              system_fingerprint: fingerprint,
              choices: [{
                index: 0,
                delta: { role: "assistant" },
                logprobs: null,
                finish_reason: null
              }]
            };
            await sendChunk(controller, initialChunk);

            // 2. 发送所有内容块
            for (const chunk of contentChunks) {
              const contentChunk = {
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model: "UnlimitedAI",
                system_fingerprint: fingerprint,
                choices: [{
                  index: 0,
                  delta: { content: chunk },
                  logprobs: null,
                  finish_reason: null
                }]
              };
              await sendChunk(controller, contentChunk);
            }

            // 3. 发送结束块
            const endChunk = {
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model: "UnlimitedAI",
              system_fingerprint: fingerprint,
              choices: [{
                index: 0,
                delta: {},
                logprobs: null,
                finish_reason: finishReason
              }]
            };
            await sendChunk(controller, endChunk);
            
            // 4. 发送结束标记
            controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          } catch (e) {
            console.error("Error in stream:", e);
          } finally {
            controller.close();
          }
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
      console.log("Returning non-stream response");
      const response = {
        id: responseId,
        object: "chat.completion",
        created,
        model: "UnlimitedAI",
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: fullContent,
            refusal: null,
            annotations: []
          },
          logprobs: null,
          finish_reason: finishReason
        }],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
          prompt_tokens_details: {
            cached_tokens: 0,
            audio_tokens: 0
          },
          completion_tokens_details: {
            reasoning_tokens: 0,
            audio_tokens: 0,
            accepted_prediction_tokens: 0,
            rejected_prediction_tokens: 0
          }
        },
        service_tier: "default"
      };

      return new Response(JSON.stringify(response), {
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (e) {
    console.error("Error processing chat request:", e);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: e.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

// 辅助函数：发送流式块
async function sendChunk(controller: ReadableStreamDefaultController, chunk: any) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
  await new Promise(resolve => setTimeout(resolve, 20)); // 添加小延迟
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
        permission: [{
          id: "modelperm-UnlimitedAI",
          object: "model_permission",
          created: Math.floor(Date.now() / 1000),
          allow_create_engine: false,
          allow_sampling: true,
          allow_logprobs: false,
          allow_search_indices: false,
          allow_view: true,
          allow_fine_tuning: false,
          organization: "*",
          group: null,
          is_blocking: false
        }],
        root: "UnlimitedAI",
        parent: null
      }
    ]
  };

  return new Response(JSON.stringify(response), {
    headers: { "Content-Type": "application/json" },
  });
}

// 主请求处理器
async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  console.log(`Received request: ${request.method} ${url.pathname}`);

  try {
    if (url.pathname === "/v1/models") {
      console.log("Handling models request");
      return handleModelsRequest();
    } else if (url.pathname === "/v1/chat/completions") {
      console.log("Handling chat completions request");
      return await handleChatRequest(request);
    } else {
      console.log(`Unknown path requested: ${url.pathname}`);
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (e) {
    console.error("Error in handler:", e);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: e.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

// 启动服务器
console.log("Server running");

Deno.serve(handler);
