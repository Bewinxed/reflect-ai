import type { ServerWebSocket } from 'bun';
import diagnostics_channel from 'node:diagnostics_channel';
import { EventEmitter } from 'node:events';
import type { ChatCompletionMessageParam } from 'openai/resources.mjs';
import type {
  ClaudeEvent,
  MessageStartEvent,
  NewChatRequest,
  Payload,
  TabFocusEvent,
  WorkerUpdateActiveConversationEvent
} from '../types/claude';
import { AnthropicToOpenAIAdapter } from './claude-openai-converter';

// Simpler client connection interface with just what we need
interface ClientConnection {
  ws: ServerWebSocket<WebSocketData>;
  conversations: Set<string>; // Track active conversations this tab has accessed
  isNewTab: boolean; // Whether this tab is on the /new page
  lastHeartbeat: number; // Last time we heard from this tab
}

// WebSocket connection data
interface WebSocketData {
  clientId: string;
  adapter?: AnthropicToOpenAIAdapter;
  openaiRequestId?: string;
}

// OpenAI completion request structure
interface CompletionRequest {
  messages: ChatCompletionMessageParam[];
  stream?: boolean;
  response_format?: {
    type: string;
    schema?: Record<string, any>;
    json_schema?: Record<string, any>;
  };
}

// Global state
const clients = new Map<string, ClientConnection>();
const conversationToClient = new Map<string, string>(); // Maps conversation ID to primary clientId
const streamBridge = new EventEmitter();
const LOG_LEVEL = 'info'; // Configurable: 'info', 'warn', 'error'
const TAB_TIMEOUT_MS = 30000; // Consider a tab inactive after 30s without heartbeat

// ANSI colors for terminal output
const colors = {
  info: '\x1b[36m', // cyan
  warn: '\x1b[33m', // yellow
  error: '\x1b[31m', // red
  reset: '\x1b[0m' // reset
};

// Create diagnostics channels for logging and performance
const logChannel = diagnostics_channel.channel('logger');
const perfChannel = diagnostics_channel.channel('performance');

// Simple logging function
function log(level: 'info' | 'warn' | 'error', message: string) {
  const levels = { error: 0, warn: 1, info: 2 };
  if (levels[level] <= levels[LOG_LEVEL]) {
    const timestamp = new Date().toISOString();
    const formattedMessage = `${timestamp} ${
      colors[level]
    }[${level.toUpperCase()}]${colors.reset} ${message}`;
    console.log(formattedMessage);

    // Publish to diagnostics channel
    logChannel.publish({
      level,
      message,
      timestamp
    });
  }
}

// Periodic cleanup of inactive tabs
setInterval(() => {
  const now = Date.now();
  const staleTime = now - TAB_TIMEOUT_MS;

  // Check each client for heartbeat age
  for (const [clientId, client] of clients.entries()) {
    if (client.lastHeartbeat < staleTime) {
      log(
        'warn',
        `Tab ${clientId} timed out (no heartbeat for ${Math.round(
          (now - client.lastHeartbeat) / 1000
        )}s)`
      );

      // Clean up conversation mappings
      client.conversations.forEach((convId) => {
        if (conversationToClient.get(convId) === clientId) {
          conversationToClient.delete(convId);
        }
      });

      // Close connection and remove client
      try {
        client.ws.close();
      } catch (e) {
        // Ignore close errors
      }
      clients.delete(clientId);
    }
  }

  // Log active tab counts
  const totalTabs = clients.size;
  const newTabs = [...clients.values()].filter((c) => c.isNewTab).length;
  log('info', `Active tabs: ${totalTabs}, New tabs: ${newTabs}`);
}, 10000); // Check every 10 seconds

// WebSocket server
const server = Bun.serve<WebSocketData>({
  port: 3002,
  fetch(req, server) {
    const url = new URL(req.url);

    // Extract auth_id from URL if present
    const authId = url.searchParams.get('auth_id');
    if (authId) {
      log('info', `Request with auth_id: ${authId}`);
    }

    if (url.pathname === '/ws') {
      // For WebSocket connections, upgrade the request
      const tabId = url.searchParams.get('tabId');
      if (!tabId) {
        log('warn', 'WebSocket connection attempt without tabId');
        return new Response('Missing tabId parameter', { status: 400 });
      }

      if (server.upgrade(req, { data: { clientId: tabId } })) {
        return;
      }
    }

    if (url.pathname.endsWith('/v1/chat/completions')) {
      return handleCompletionsRequest(req);
    }

    return new Response('Not found', { status: 404 });
  },
  websocket: {
    async open(ws) {
      const clientId = ws.data.clientId;
      const now = Date.now();

      // Initialize the client connection
      clients.set(clientId, {
        ws,
        conversations: new Set(),
        isNewTab: false, // Will be updated when client sends worker_register
        lastHeartbeat: now
      });

      log('info', `Tab connected: ${clientId}`);
      ws.ping();
    },
    async close(ws) {
      const clientId = ws.data.clientId;
      const client = clients.get(clientId);

      if (client) {
        // Clean up conversation mappings
        client.conversations.forEach((convId) => {
          if (conversationToClient.get(convId) === clientId) {
            conversationToClient.delete(convId);
          }
        });

        clients.delete(clientId);
        log('warn', `Tab disconnected: ${clientId}`);
      }
    },
    async message(ws, raw) {
      try {
        await handleMessage(ws, raw);
      } catch (error) {
        log('error', `Error handling message: ${error}`);
        throw error;
      }
    }
  }
});

async function handleMessage(
  ws: ServerWebSocket<WebSocketData>,
  raw: string | Buffer
) {
  const clientId = ws.data.clientId;
  let message: Payload;

  try {
    message = JSON.parse(raw.toString()) as Payload;

    // Get client connection
    const client = clients.get(clientId);
    if (!client) {
      log('error', `Message from unknown client: ${clientId}`);
      return;
    }

    // Update client's last heartbeat time
    client.lastHeartbeat = Date.now();

    // Process different message types
    switch (message.type) {
      case 'ping': {
        // Respond with pong
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        break;
      }

      case 'worker_register': {
        // Register the tab - use type assertion to access typed content
        const registerEvent = message;

        // Update the client's isNewTab status based on content or top-level flag
        client.isNewTab =
          message.is_new_tab || registerEvent.content?.isWorker || false;

        log(
          'info',
          `Tab ${clientId} registered as ${
            client.isNewTab ? 'new tab' : 'conversation tab'
          }`
        );

        // Log the number of /new tabs available
        const newTabs = [...clients.values()].filter((c) => c.isNewTab);
        log('info', `Total tabs: ${clients.size}, New tabs: ${newTabs.length}`);
        break;
      }

      case 'worker_update_active_conversation': {
        // Update active conversation - use type assertion to access typed content
        const updateEvent = message as WorkerUpdateActiveConversationEvent;
        const convId = updateEvent.content?.conversationId;

        if (convId) {
          // If this was a /new tab, it's not anymore
          if (client.isNewTab) {
            client.isNewTab = false;
            log(
              'info',
              `Tab ${clientId} changed from /new to conversation: ${convId}`
            );
          }

          // Update client state
          client.conversations.add(convId);

          // Map this conversation to this client
          conversationToClient.set(convId, clientId);

          log('info', `Tab ${clientId} active conversation: ${convId}`);
        }
        break;
      }

      case 'tab_focus': {
        // Tab focus event - use type assertion
        const focusEvent = message as TabFocusEvent;
        log(
          'info',
          `Tab ${clientId} focus changed: active=${focusEvent.content?.active}, isNewTab=${client.isNewTab}`
        );
        break;
      }

      case 'message_start': {
        // Process message start through adapter
        processAdapterEvent(ws, message);

        // Extract conversation ID from message
        const startEvent = message as MessageStartEvent;
        const convId =
          message.conversation_uuid || startEvent.message?.conversation_uuid;

        if (convId) {
          client.conversations.add(convId);
          conversationToClient.set(convId, clientId);
        }
        break;
      }

      case 'message_stop': {
        // Process message stop through adapter
        processAdapterEvent(ws, message);

        // Clean up adapter when message completes
        const requestId = ws.data.openaiRequestId;
        if (requestId) {
          streamBridge.emit(`complete:${requestId}`);
          ws.data.adapter = undefined;
          delete ws.data.openaiRequestId;
        }
        break;
      }

      default: {
        // Process all other message types through adapter
        processAdapterEvent(ws, message);
        break;
      }
    }
  } catch (error) {
    log('error', `Failed to parse message from ${clientId}: ${error}`);
    throw error;
  }
}

// Process events through the OpenAI adapter
// In your server.ts (Bun server code)

function processAdapterEvent<T extends ClaudeEvent['type']>(
  ws: ServerWebSocket<WebSocketData>,
  message: Payload<T>
) {
  const clientId = ws.data.clientId;
  const requestId = ws.data.openaiRequestId;

  if (!requestId || !ws.data.adapter) {
    return;
  }
  const adapter = ws.data.adapter;

  try {
    const chunk = adapter.processEvent(message);
    if (chunk) {
      streamBridge.emit(`chunk:${requestId}`, chunk);
    }
  } catch (error) {
    // Catch any error thrown

    // Message was not JSON, treat as a generic error from the adapter (e.g., internal bug)
    log('error', `${requestId}: ${error.message}`);
    streamBridge.emit(`error:${requestId}`, {
      message: (error as Error).message,
      type: 'adapter_internal_error', // Different type to distinguish
      code: 'ADAPTER_INTERNAL_EXCEPTION'
    });
    throw error;
  }
}

async function handleCompletionsRequest(req: Request): Promise<Response> {
  const start = performance.now();

  try {
    const url = new URL(req.url);
    const authId = url.searchParams.get('auth_id');

    // Parse request body
    let body: CompletionRequest;
    try {
      body = await req.json();
    } catch (error) {
      log('error', `Invalid JSON in request: ${error}`);
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Find the best client for this request
    let client = findBestClientForRequest(authId);

    if (!client) {
      return new Response(JSON.stringify({ error: 'No clients connected' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    log(
      'info',
      `Selected client for completions request: ${client.ws.data.clientId}, isNewTab=${client.isNewTab}`
    );

    // Set up adapter for OpenAI compatibility
    const adapter = new AnthropicToOpenAIAdapter({ debug: false });
    const requestId = crypto.randomUUID();
    client.ws.data.adapter = adapter;
    client.ws.data.openaiRequestId = requestId;

    // Create the message to send to Claude
    const wsMessage = createNewChatRequest(body);

    // Handle streaming vs non-streaming response
    const response = body.stream
      ? createStreamingResponse(client, wsMessage, requestId)
      : await createSynchronousResponse(client, wsMessage, requestId, adapter);

    // Log performance metrics
    const duration = performance.now() - start;
    perfChannel.publish({
      action: 'request_completed',
      endpoint: '/v1/chat/completions',
      duration,
      streaming: body.stream,
      timestamp: new Date().toISOString()
    });

    return response;
  } catch (error) {
    log('error', `Error handling completions request: ${error}`);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Find the best client to handle a request
function findBestClientForRequest(
  authId: string | null
): ClientConnection | undefined {
  // Strategy 1: If authId is specified, find a client with that conversation
  if (authId) {
    const clientId = conversationToClient.get(authId);
    if (clientId) {
      const client = clients.get(clientId);
      if (client) {
        log('info', `Found client ${clientId} for conversation ${authId}`);
        return client;
      }
    }
  }

  // Strategy 2: Prefer a /new tab if available
  const newTabs = [...clients.values()].filter((c) => c.isNewTab);
  if (newTabs.length > 0) {
    const client = newTabs[0];
    log('info', `Using /new tab ${client.ws.data.clientId} for request`);
    return client;
  }

  // Strategy 3: Fall back to any available client
  if (clients.size > 0) {
    const client = [...clients.values()].at(-1)!;
    log(
      'info',
      `No specific client found, using first available: ${client.ws.data.clientId}`
    );
    return client;
  }

  log('error', 'No clients available to handle request');
  return undefined;
}

// Create a new chat request from OpenAI messages
function createNewChatRequest(body: CompletionRequest): NewChatRequest {
  // Handle JSON format if specified
  const messages = [...body.messages];

  // Add system instruction for JSON formatting if needed
  if (body.response_format?.type === 'json_object') {
    const schema =
      body.response_format.schema ?? body.response_format.json_schema;
    messages.splice(0, 0, {
      role: 'system',
      content: `Please format your response as JSON according to this schema:\`\`\`json\n${JSON.stringify(
        schema
      )}\n\`\`\`\nWRAP IT IN \`\`\` DO NOT SAY ANYTHING ELSE`
    });
  }

  // Convert OpenAI messages to Claude format
  return {
    type: 'new_chat_request',
    data: {
      chat_messages: [
        {
          text: messages
            .map((msg: ChatCompletionMessageParam) => {
              const prefix =
                msg.role === 'user'
                  ? 'Human: '
                  : msg.role === 'system'
                  ? ''
                  : 'Assistant: ';
              return `${prefix}${msg.content}`;
            })
            .join('\n\n')
        }
      ]
    }
  };
}

// Create a streaming response
function createStreamingResponse(
  client: ClientConnection,
  wsMessage: NewChatRequest,
  requestId: string
): Response {
  // Set up streaming
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  // Set up event handlers
  streamBridge.on(`chunk:${requestId}`, (chunk) => {
    writer.write(
      new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`)
    );
  });

  streamBridge.on('error', (error) => {
    writer.write(
      new TextEncoder().encode(`data: {"error": "${error.message}"}\n\n`)
    );
    writer.close();
    // Clean up listeners
    streamBridge.removeAllListeners(`chunk:${requestId}`);
    streamBridge.removeAllListeners(`complete:${requestId}`);
  });

  streamBridge.on(`complete:${requestId}`, () => {
    writer.write(new TextEncoder().encode('data: [DONE]\n\n'));
    writer.close();
    // Clean up listeners
    streamBridge.removeAllListeners(`chunk:${requestId}`);
    streamBridge.removeAllListeners(`complete:${requestId}`);
  });

  // Send the request to the client
  client.ws.send(JSON.stringify(wsMessage));

  // Return the stream
  return new Response(stream.readable, {
    headers: getStreamHeaders()
  });
}

// Create a synchronous response
// Create a synchronous response
async function createSynchronousResponse(
  client: ClientConnection,
  wsMessage: NewChatRequest,
  requestId: string,
  adapter: AnthropicToOpenAIAdapter
): Promise<Response> {
  return new Promise((resolve) => {
    const chunks: any[] = [];
    const fullContent: string[] = [];

    // Collect chunks
    streamBridge.on(`chunk:${requestId}`, (chunk) => {
      chunks.push(chunk);

      // Extract content from the chunk if available
      if (chunk?.choices?.[0]?.delta?.content) {
        fullContent.push(chunk.choices[0].delta.content);
      }
    });

    // Handle errors properly
    streamBridge.on(`error:${requestId}`, (error) => {
      log(
        'error',
        `Error in synchronous response for ${requestId}: ${error.message}`
      );
      resolve(
        new Response(
          JSON.stringify({
            error: {
              message: error.message,
              type: error.type || 'server_error',
              code: error.code || 'error_processing_request'
            }
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      );

      // Clean up listeners
      streamBridge.removeAllListeners(`chunk:${requestId}`);
      streamBridge.removeAllListeners(`complete:${requestId}`);
      streamBridge.removeAllListeners(`error:${requestId}`);
    });

    // Resolve when complete
    streamBridge.on(`complete:${requestId}`, () => {
      try {
        // If we have no chunks, that's an error condition
        if (chunks.length === 0) {
          throw new Error('No response chunks received before completion');
        }

        // Get the model from the chunks
        const modelName = chunks[0].model || 'unknown';

        // Construct a complete OpenAI format response
        const completion: ChatCompletion = {
          id: requestId,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: modelName,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: fullContent.join('') // Combine all content chunks
              },
              finish_reason: 'stop',
              logprobs: null
            }
          ],
          usage: chunks.find((c) => c.usage)?.usage || {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
          }
        };

        log('info', `Synchronous response complete for ${requestId}`);

        resolve(
          new Response(JSON.stringify(completion), {
            headers: { 'Content-Type': 'application/json' }
          })
        );
      } catch (error) {
        // Properly propagate the error to the client
        log('error', `Failed to create completion response: ${error}`);
        resolve(
          new Response(
            JSON.stringify({
              error: {
                message: (error as Error).message,
                type: 'server_error',
                code: 'error_processing_response'
              }
            }),
            {
              status: 500,
              headers: { 'Content-Type': 'application/json' }
            }
          )
        );
      }

      // Clean up listeners
      streamBridge.removeAllListeners(`chunk:${requestId}`);
      streamBridge.removeAllListeners(`complete:${requestId}`);
      streamBridge.removeAllListeners(`error:${requestId}`);
    });

    // Send the request to the client
    client.ws.send(JSON.stringify(wsMessage));
  });
}

// Headers for SSE streaming
function getStreamHeaders() {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  };
}

log('info', 'Server running on port 3002');
