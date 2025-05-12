import type { HTMLBundle, ServerWebSocket } from 'bun';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { EventEmitter } from 'node:events';
import ui from './ui.html';

import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  CreateChatCompletionRequestMessage
} from 'openai/resources';

import {
  ContentType,
  type ChatConversation,
  type ChatMessage,
  type ClaudeEvent,
  type MessageDeltaEvent,
  type NewChatRequest
} from '../types/claude';
import type { Payload } from '../types/common';
import * as schema from './schema';

interface ClientConnection {
  ws: ServerWebSocket<WebSocketData>;
  activeConversation: string | null;
  clientId: string;
}

const clients = new Map<string, ClientConnection>();

interface ContentBlock {
  index: number;
  content: string;
  type?: string;
  jsonParts?: string[];
}

function escapeJsonString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

interface WebSocketData {
  currentMessage: {
    id: string;
    conversation_uuid: string;
    contentBlocks: ContentBlock[];
    model: string;
    artifacts: string[];
    created_at: string;
    currentBlockIndex: number;
    activeCodeBlock: boolean;
    toolCalls: Map<
      string,
      {
        isFirstChunk: boolean;
        hasContent: boolean;
      }
    > | null;
  } | null;

  activeConversation: string | null;
  clientId: string;
  openaiRequestId?: string; // Add this line
}

// Constants and initialization
const sqlite = new Database('claude.db', {
  create: true
});
const db = drizzle(sqlite, { schema });
// Run migrations on startup
migrate(db, { migrationsFolder: './drizzle' });

const loggerColors = {
  info: Bun.color('blue', 'ansi'),
  error: Bun.color('red', 'ansi'),
  warn: Bun.color('yellow', 'ansi'),
  reset: '\x1b[0m'
};
const color_reset = '\x1b[0m';

function log(level: keyof typeof loggerColors, message: string) {
  const color = loggerColors[level];
  console.log(
    `[${color}${level.toUpperCase()}${color_reset}] ${message}${color_reset}`
  );
}

class CloodCursor {
  public current_conversation_uuid: string | null;
  public ws_client: ServerWebSocket<WebSocketData> | null;
  public current_message_uuid: string | null;
  public current_message_buffer: string;

  public chat_messages: Map<string, ChatMessage>;
  public conversations: Map<string, ChatConversation>;

  constructor(conversation_uuid: string | null, chat_messages: ChatMessage[]) {
    this.chat_messages = new Map(
      chat_messages.reduce((acc, message) => {
        acc.set(message.uuid, message);
        return acc;
      }, new Map())
    );
    this.conversations = new Map();
    this.current_conversation_uuid = conversation_uuid;

    this.current_message_uuid = null;
    this.current_message_buffer = '';
    this.ws_client = null;
  }

  public newMessage(message: ChatMessage) {
    this.chat_messages.set(message.uuid, message);
  }

  public appendToCurrentMessage(text: string) {
    this.current_message_buffer += text;
  }
}

const cursor = new CloodCursor(null, []);

// WebSocket server setup
const server = Bun.serve<WebSocketData>({
  port: 3002,
  //   static: './static',

  fetch(req, server) {
    // openai-like-api
    const url = new URL(req.url);
    if (url.pathname === '/') {
      console.log(ui);
      return new Response(Bun.file('./ui.html'));
    }
    console.log(url.pathname);
    if (url.pathname === '/ws') {
      if (server.upgrade(req)) return;
    }

    if (url.pathname.endsWith('/v1/chat/completions')) {
      return handleCompletionsRequest(req);
    }

    if (req.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    return new Response('Not found', { status: 404 });
  },
  websocket: {
    async open(ws) {
      const clientId = crypto.randomUUID();
      ws.data = {
        currentMessage: null,
        activeConversation: null,
        clientId
      };

      // Add to clients map
      clients.set(clientId, {
        ws,
        activeConversation: null,
        clientId
      });

      clients;
    },
    async close(ws) {
      // Remove from clients map
      clients.delete(ws.data.clientId);
    },

    async message(ws, raw) {
      handleMessage(ws, raw);
    }
  }
});

async function handleMessage(
  ws: ServerWebSocket<WebSocketData>,
  raw: string | Buffer
) {
  let content: any;
  try {
    // The content is sometimes nested under .content in the JSON
    const rawStr = raw.toString();
    log('info', `Raw WS message: ${rawStr.substring(0, 100)}...`);

    const parsed = JSON.parse(rawStr);
    content = parsed.content || parsed;

    log('info', ` - [WS] - ${content.type}`);
  } catch (error) {
    log(
      'error',
      `Error parsing message: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return;
  }

  cursor.ws_client = ws;
  cursor.ws_client.ping();

  if (content.type === 'ping') {
    return ws.pong();
  }

  // Skip processing if not part of a completions request
  const requestId = ws.data.openaiRequestId;
  if (!requestId) {
    log(
      'info',
      `No requestId found in ws.data, skipping event: ${content.type}`
    );
    return;
  }

  log('info', `Processing ${content.type} event for requestId: ${requestId}`);

  switch (content.type) {
    case 'new_conversation': {
      log('info', `New conversation created with UUID: ${content.data.uuid}`);
      cursor.current_conversation_uuid = content.data.uuid;
      cursor.conversations.set(content.data.uuid, {});
      break;
    }
    case 'message_start': {
      log('info', `Message started with UUID: ${content.message.uuid}`);
      cursor.current_message_uuid = content.message.uuid;
      cursor.current_message_buffer = '';

      // Initialize current message in websocket data
      ws.data.currentMessage = {
        id: content.message.uuid,
        conversation_uuid: cursor.current_conversation_uuid || '',
        contentBlocks: [],
        model: content.message.model || '',
        artifacts: [],
        created_at: new Date().toISOString(),
        currentBlockIndex: 0,
        activeCodeBlock: false
      };

      // Send initial role chunk for OpenAI compatibility
      log(
        'info',
        `Emitting start event for requestId: ${requestId}, messageId: ${content.message.uuid}`
      );
      streamBridge.emit(`start:${requestId}`, content.message.uuid);
      break;
    }
    case 'content_block_start': {
      log(
        'info',
        `Content block ${content.index} started, type: ${content.content_block.type}`
      );

      // Add the content block to our tracking
      if (!ws.data.currentMessage) {
        log('info', `No currentMessage in ws.data, creating new one`);
        ws.data.currentMessage = {
          id: cursor.current_message_uuid || '',
          conversation_uuid: cursor.current_conversation_uuid || '',
          contentBlocks: [],
          model: '',
          artifacts: [],
          created_at: new Date().toISOString(),
          currentBlockIndex: 0,
          activeCodeBlock: false,
          toolCalls: new Map() // Initialize the tool calls map
        };
      }

      // Add the new block
      ws.data.currentMessage.contentBlocks[content.index] = {
        index: content.index,
        content:
          content.content_block.text || content.content_block.thinking || '',
        type: content.content_block.type
      };

      if (content.content_block.type === 'text') {
        if (content.content_block.text) {
          log(
            'info',
            `Adding text to message buffer: ${content.content_block.text}`
          );
          cursor.current_message_buffer += content.content_block.text;

          log('info', `Emitting message event for requestId: ${requestId}`);
          streamBridge.emit(
            `message:${requestId}`,
            content.content_block.text,
            cursor.current_message_uuid || ''
          );
        }
      } else if (content.content_block.type === 'thinking') {
        // Start a tool call for thinking type
        const toolCallId = `thinking_${content.index}`;

        // Initialize tool call tracking
        ws.data.currentMessage.toolCalls.set(toolCallId, {
          isFirstChunk: true,
          hasContent: false
        });

        log(
          'info',
          `Emitting tool_call_start for requestId: ${requestId}, toolCallId: ${toolCallId}`
        );
        streamBridge.emit(
          `tool_call_start:${requestId}`,
          toolCallId,
          'thinking',
          cursor.current_message_uuid || ''
        );

        // If there's initial thinking content, send it
        if (content.content_block.thinking) {
          const escapedContent = escapeJsonString(
            content.content_block.thinking
          );
          log(
            'info',
            `Emitting tool_call_delta with initial thinking: ${escapedContent}`
          );

          // Send as first chunk
          streamBridge.emit(
            `tool_call_delta:${requestId}`,
            toolCallId,
            escapedContent,
            cursor.current_message_uuid || '',
            true, // isFirstChunk
            false // isLastChunk
          );

          // Update tracking
          ws.data.currentMessage.toolCalls.set(toolCallId, {
            isFirstChunk: false,
            hasContent: true
          });
        }
      }
      break;
    }

    // Helper function to escape JSON strings

    case 'content_block_delta': {
      if (!ws.data.currentMessage) {
        log(
          'warn',
          `Received content_block_delta but no currentMessage in ws.data`
        );
        break;
      }

      const blockIndex = content.index;
      log(
        'info',
        `Content block delta for index ${blockIndex}, type: ${content.delta.type}`
      );

      const block = ws.data.currentMessage.contentBlocks[blockIndex];

      if (!block) {
        // Create the block if it doesn't exist yet
        log('info', `No block found for index ${blockIndex}, creating new one`);
        ws.data.currentMessage.contentBlocks[blockIndex] = {
          index: blockIndex,
          content: '',
          type: content.delta.type.replace('_delta', '')
        };
      }

      if (content.delta.type === 'text_delta' && content.delta.text) {
        log(
          'info',
          `Adding text delta to message buffer: ${content.delta.text}`
        );
        cursor.current_message_buffer += content.delta.text;

        log(
          'info',
          `Emitting message event for text delta, requestId: ${requestId}`
        );
        streamBridge.emit(
          `message:${requestId}`,
          content.delta.text,
          cursor.current_message_uuid || ''
        );

        // Update the block content
        if (ws.data.currentMessage.contentBlocks[blockIndex]) {
          ws.data.currentMessage.contentBlocks[blockIndex].content +=
            content.delta.text;
        }
      } else if (
        content.delta.type === 'thinking_delta' &&
        content.delta.thinking
      ) {
        // Send thinking delta as tool call delta
        const toolCallId = `thinking_${blockIndex}`;
        const escapedContent = escapeJsonString(content.delta.thinking);

        // Get tracking info
        const toolCallInfo = ws.data.currentMessage.toolCalls.get(
          toolCallId
        ) || {
          isFirstChunk: true,
          hasContent: false
        };

        log(
          'info',
          `Emitting tool_call_delta for thinking: ${escapedContent}, isFirstChunk: ${toolCallInfo.isFirstChunk}`
        );

        streamBridge.emit(
          `tool_call_delta:${requestId}`,
          toolCallId,
          escapedContent,
          cursor.current_message_uuid || '',
          toolCallInfo.isFirstChunk, // isFirstChunk
          false // isLastChunk
        );

        // Update tracking
        ws.data.currentMessage.toolCalls.set(toolCallId, {
          isFirstChunk: false,
          hasContent: true
        });

        // Update the block content
        if (ws.data.currentMessage.contentBlocks[blockIndex]) {
          ws.data.currentMessage.contentBlocks[blockIndex].content +=
            content.delta.thinking;
        }
      } else if (
        content.delta.type === 'thinking_summary_delta' &&
        content.delta.summary?.summary
      ) {
        // Handle summary deltas - add as normal content with a SUMMARY prefix
        const toolCallId = `thinking_${blockIndex}`;
        const summaryContent = `[SUMMARY: ${content.delta.summary.summary}]`;
        const escapedContent = escapeJsonString(summaryContent);

        // Get tracking info
        const toolCallInfo = ws.data.currentMessage.toolCalls.get(
          toolCallId
        ) || {
          isFirstChunk: true,
          hasContent: false
        };

        log(
          'info',
          `Emitting tool_call_delta for thinking summary: ${escapedContent}, isFirstChunk: ${toolCallInfo.isFirstChunk}`
        );

        streamBridge.emit(
          `tool_call_delta:${requestId}`,
          toolCallId,
          escapedContent,
          cursor.current_message_uuid || '',
          toolCallInfo.isFirstChunk, // isFirstChunk
          false // isLastChunk
        );

        // Update tracking
        ws.data.currentMessage.toolCalls.set(toolCallId, {
          isFirstChunk: false,
          hasContent: true
        });
      }
      break;
    }

    case 'content_block_stop': {
      if (!cursor.current_message_uuid) {
        log(
          'warn',
          ` - [WS] - ${'Current Message Is Null, Cannot Process Message'}`
        );
        break;
      }

      if (!ws.data.currentMessage) {
        log(
          'warn',
          `Received content_block_stop but no currentMessage in ws.data`
        );
        break;
      }

      const blockIndex = content.index;
      log('info', `Content block ${blockIndex} stopped`);

      const block = ws.data.currentMessage.contentBlocks[blockIndex];

      if (!block) {
        log(
          'warn',
          `No block found for index ${blockIndex} during content_block_stop`
        );
        break;
      }

      if (block.type === 'thinking') {
        // End the tool call
        const toolCallId = `thinking_${blockIndex}`;

        // Get tracking info
        const toolCallInfo = ws.data.currentMessage.toolCalls.get(toolCallId);

        // Send a final empty chunk if needed to close the JSON properly
        if (toolCallInfo && toolCallInfo.hasContent) {
          log(
            'info',
            `Emitting final tool_call_delta for thinking block to close JSON string`
          );

          streamBridge.emit(
            `tool_call_delta:${requestId}`,
            toolCallId,
            '', // Empty content for final chunk
            cursor.current_message_uuid || '',
            false, // isFirstChunk
            true // isLastChunk
          );
        }

        log(
          'info',
          `Emitting tool_call_end for thinking block, requestId: ${requestId}, toolCallId: ${toolCallId}`
        );
        streamBridge.emit(
          `tool_call_end:${requestId}`,
          toolCallId,
          cursor.current_message_uuid
        );

        // Remove from tracking
        ws.data.currentMessage.toolCalls.delete(toolCallId);
      } else if (block.type === 'text') {
        // Store text content
        log(
          'info',
          `Storing text content in cursor.chat_messages: ${cursor.current_message_buffer}`
        );
        cursor.chat_messages.set(cursor.current_message_uuid, {
          content: [
            {
              type: ContentType.Text,
              text: cursor.current_message_buffer
            }
          ],
          uuid: cursor.current_message_uuid,
          sender: 'assistant'
        });
        console.log(cursor.current_message_buffer);
      }
      break;
    }

    case 'message_delta': {
      log('info', `Message delta received: ${JSON.stringify(content.delta)}`);
      break;
    }
    case 'message_limit': {
      log(
        'info',
        `Message limit received: ${JSON.stringify(content.message_limit)}`
      );
      break;
    }
    case 'message_stop': {
      log(
        'info',
        `Message stop received, finishing stream for requestId: ${requestId}`
      );

      // Emit end event for OpenAI streaming when the message is completely done
      if (cursor.current_message_uuid) {
        log(
          'info',
          `Emitting end event for requestId: ${requestId}, messageId: ${cursor.current_message_uuid}`
        );
        streamBridge.emit(`end:${requestId}`, cursor.current_message_uuid);

        // Clear the requestId since it's done
        log('info', `Clearing requestId from websocket data: ${requestId}`);
        delete ws.data.openaiRequestId;
        ws.data.currentMessage = null;
      } else {
        log('warn', `No current_message_uuid found during message_stop event`);
      }

      cursor.current_message_uuid = null;
      break;
    }
    default: {
      // Just log other event types
      log('warn', ` - [WS] - Unhandled event type: ${content.type}`);
    }
  }

  // Debug: Log current streamBridge event listeners
  log(
    'info',
    `Current streamBridge listeners: ${JSON.stringify(
      streamBridge.eventNames()
    )}`
  );
  streamBridge.eventNames().forEach((event) => {
    log(
      'info',
      `Listener count for ${event}: ${streamBridge.listenerCount(
        event as string
      )}`
    );
  });
}
import { inspect } from 'util';

function debugEventEmitter(emitter: EventEmitter) {
  const originalOn = emitter.on;
  const originalEmit = emitter.emit;

  emitter.on = function (eventName, listener) {
    log('info', `Registering listener for event: ${eventName}`);
    return originalOn.call(this, eventName, listener);
  };

  emitter.emit = function (eventName, ...args) {
    log('info', `Emitting event: ${eventName} with ${args.length} arguments`);
    return originalEmit.call(this, eventName, ...args);
  };

  return emitter;
}

// const streamBridge = new EventEmitter();
const streamBridge = debugEventEmitter(new EventEmitter());

// async generator
async function handleCompletionsRequest(req: Request): Promise<Response> {
  log('info', `create chat completions request`);
  // Only handle POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await req.json();
    const { messages, model = 'claude-3-opus-20240229' } = body;

    // Validate that we have messages
    if (!messages || !Array.isArray(messages)) {
      log('error', ` - [WS] - Invalid request: messages must be an array`);
      return new Response(
        JSON.stringify({ error: 'Invalid request: messages must be an array' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Combine messages into a prompt for Claude
    const prompt = (messages as ChatCompletionMessageParam[])
      .map((msg) => {
        const prefix = msg.role === 'user' ? 'Human: ' : 'Assistant: ';
        return `${prefix}${msg.content}`;
      })
      .join('\n');

    // Create a unique ID for this request
    const requestId = crypto.randomUUID();

    // Create a stream for the response
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    // Create listeners for this specific stream
    const messageHandler = (data: string, messageId: string) => {
      const chunk = {
        id: `chatcmpl-${messageId}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [
          {
            delta: { content: data },
            index: 0,
            finish_reason: null
          }
        ]
      };

      const chunkStr = `data: ${JSON.stringify(chunk)}\n\n`;
      writer.write(new TextEncoder().encode(chunkStr));
    };

    const startHandler = (messageId: string) => {
      const chunk = {
        id: `chatcmpl-${messageId}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [
          {
            delta: { role: 'assistant' },
            index: 0,
            finish_reason: null
          }
        ]
      };

      const chunkStr = `data: ${JSON.stringify(chunk)}\n\n`;
      writer.write(new TextEncoder().encode(chunkStr));
    };

    const endHandler = (messageId: string) => {
      const chunk = {
        id: `chatcmpl-${messageId}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [
          {
            delta: {},
            index: 0,
            finish_reason: 'stop'
          }
        ]
      };

      const chunkStr = `data: ${JSON.stringify(chunk)}\n\n`;
      writer.write(new TextEncoder().encode(chunkStr));

      // Send the [DONE] marker
      writer.write(new TextEncoder().encode('data: [DONE]\n\n'));

      // Close the writer
      writer.close();

      // Clean up listeners
      cleanupEventListeners(requestId);
    };

    // 1. Tool call start - first chunk
    const toolCallStartHandler = (
      toolId: string,
      toolType: string,
      messageId: string
    ) => {
      const chunk = {
        id: `chatcmpl-${messageId}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: toolId,
                  type: 'function',
                  function: {
                    name: toolType,
                    arguments: '{' // Start with opening brace
                  }
                }
              ]
            },
            index: 0,
            finish_reason: null
          }
        ]
      };

      const chunkStr = `data: ${JSON.stringify(chunk)}\n\n`;
      writer.write(new TextEncoder().encode(chunkStr));
    };

    // 2. Tool call delta - middle chunks (send arguments as valid JSON key-value pairs)
    const toolCallDeltaHandler = (
      toolId: string,
      content: string,
      messageId: string,
      isFirstChunk = false,
      isLastChunk = false
    ) => {
      // Format as a proper JSON key-value pair
      let jsonFragment;

      if (isFirstChunk) {
        // First chunk - include key and opening quote
        jsonFragment = `"thinking":"${content}`;
      } else if (isLastChunk) {
        // Last chunk - include closing quote
        jsonFragment = `${content}"`;
      } else {
        // Middle chunk - just the content
        jsonFragment = content;
      }

      const chunk = {
        id: `chatcmpl-${messageId}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: toolId,
                  function: {
                    arguments: jsonFragment
                  }
                }
              ]
            },
            index: 0,
            finish_reason: null
          }
        ]
      };

      const chunkStr = `data: ${JSON.stringify(chunk)}\n\n`;
      writer.write(new TextEncoder().encode(chunkStr));
    };

    // 3. Tool call end - final chunk with closing brace
    const toolCallEndHandler = (toolId: string, messageId: string) => {
      const chunk = {
        id: `chatcmpl-${messageId}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: toolId,
                  function: {
                    arguments: '}' // End with closing brace
                  }
                }
              ]
            },
            index: 0,
            finish_reason: null
          }
        ]
      };

      const chunkStr = `data: ${JSON.stringify(chunk)}\n\n`;
      writer.write(new TextEncoder().encode(chunkStr));
    };

    function cleanupEventListeners(requestId: string) {
      streamBridge.removeListener(`message:${requestId}`, messageHandler);
      streamBridge.removeListener(`start:${requestId}`, startHandler);
      streamBridge.removeListener(`end:${requestId}`, endHandler);
      streamBridge.removeListener(
        `tool_call_start:${requestId}`,
        toolCallStartHandler
      );
      streamBridge.removeListener(
        `tool_call_delta:${requestId}`,
        toolCallDeltaHandler
      );
      streamBridge.removeListener(
        `tool_call_end:${requestId}`,
        toolCallEndHandler
      );
    }

    // Register listeners
    streamBridge.on(`message:${requestId}`, messageHandler);
    streamBridge.on(`start:${requestId}`, startHandler);
    streamBridge.on(`end:${requestId}`, endHandler);
    streamBridge.on(`tool_call_start:${requestId}`, toolCallStartHandler);
    streamBridge.on(`tool_call_delta:${requestId}`, toolCallDeltaHandler);
    streamBridge.on(`tool_call_end:${requestId}`, toolCallEndHandler);

    // Find available websocket client
    const client = cursor.ws_client;
    if (!client) {
      writer.write(
        new TextEncoder().encode(
          'data: {"error": "No available WebSocket clients"}\n\n'
        )
      );
      writer.close();
      return new Response(stream.readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    // Store requestId in the websocket data
    client.data.openaiRequestId = requestId;

    // Send the request to Claude via WebSocket
    client.send(
      JSON.stringify({
        type: 'new_chat_request',
        data: {
          chat_messages: [
            {
              text: prompt
            }
          ]
        }
      } satisfies NewChatRequest)
    );

    // Return streaming response
    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  } catch (error) {
    log(
      'error',
      `Error in completions request: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

console.log('Server running on port 3002');

// cursor.ws_client.send(
//     JSON.stringify({
//       type: 'new_chat_request',
//       data: {
//         chat_messages: [
//           {
//             text: 'Hello world!'
//           }
//         ]
//       }
//     } satisfies NewChatRequest)
//   );
