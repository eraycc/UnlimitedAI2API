# UnlimitedAI2API
Reverse UnlimitedAI to an openai compatible API powered by deno

# UnlimitedAI API Proxy

这是一个Deno脚本，作为UnlimitedAI聊天服务的API代理，提供与OpenAI兼容的API接口。

## 功能特性

- 提供与OpenAI兼容的/v1/chat/completions接口
- 支持流式(stream)和非流式响应
- 支持模型列表查询(/v1/models)
- 内置鉴权机制
- 自动获取和刷新JWT令牌
- 随机User-Agent轮换
- 消息合并优化

## 快速开始

### 安装Deno

确保已安装Deno运行时环境：
- 官方安装指南: https://deno.land/manual/getting_started/installation

### 运行服务

```bash
# 设置鉴权令牌(可选，默认为"sk-your-key")
export AUTH_TOKEN="your-secret-token"

# 运行服务
deno run --allow-net --allow-env your_script_name.ts
```

### 环境变量

- `AUTH_TOKEN`: API访问令牌(默认值: "sk-your-key")

## API端点

### 获取模型列表

```
GET /v1/models
```

### 聊天补全

```
POST /v1/chat/completions
```

#### 请求头

```
Authorization: Bearer <your-auth-token>
Content-Type: application/json
```

#### 请求体参数

- `messages`: 聊天消息数组(必填)
- `stream`: 是否使用流式响应(可选，默认为false)
- `temperature`: 温度参数(可选)
- `max_tokens`: 最大令牌数(可选)

#### 响应格式

与OpenAI API兼容的格式。

## 使用示例

### 获取模型列表

```bash
curl http://localhost:port/v1/models \
  -H "Authorization: Bearer your-auth-token"
```

### 非流式聊天请求

```bash
curl http://localhost:port/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-auth-token" \
  -d '{
    "messages": [
      {"role": "user", "content": "你好"}
    ]
  }'
```

### 流式聊天请求

```bash
curl http://localhost:port/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-auth-token" \
  -d '{
    "messages": [
      {"role": "user", "content": "你好"}
    ],
    "stream": true
  }'
```

## 注意事项

1. 该服务需要网络连接以访问UnlimitedAI的API
2. 运行需要以下Deno权限:
   - `--allow-net`: 网络访问权限
   - `--allow-env`: 环境变量读取权限
