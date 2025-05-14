// src/claude-openai-converter.ts
import { EventEmitter } from 'node:events';
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionRole,
  ChatCompletion,
  CompletionUsage,
  CreateChatCompletionRequestMessage
} from 'openai/resources';

import type {
  SSEEvent,
  MessageStartEvent,
  ContentBlockDeltaEvent,
  ContentBlockStopEvent,
  MessageDeltaEvent,
  MessageStopEvent,
  ContentBlockStartEvent,
  ClaudeEvent,
  ChatMessage
} from '../types/claude'; // Import the Claude types we defined

/**
 * Options for the Anthropic to OpenAI adapter
 */
export interface AnthropicToOpenAIAdapterOptions {
  /**
   * Map Anthropic model names to OpenAI model names
   * If not provided, the original model name will be used
   */
  modelMapping?: Record<string, string>;

  /**
   * Debugging mode
   */
  debug?: boolean;
}

/**
 * Adapter class that converts Anthropic Messages API responses to OpenAI-compatible completions
 * Particularly useful for streaming responses
 */
export class AnthropicToOpenAIAdapter extends EventEmitter {
  private options: AnthropicToOpenAIAdapterOptions;
  private accumulatedText: Map<string, string> = new Map();
  private messageId: string | null = null;
  private model: string | null = null;
  private created: number = Math.floor(Date.now() / 1000);
  private stopReason: string | null = null;
  private usageInfo: CompletionUsage | null = null;
  private finishedBlocks: Set<number> = new Set();
  private startTime: number = Date.now();
  private blockTypes: Map<number, string> = new Map(); // Track block types

  /**
   * Create a new AnthropicToOpenAIAdapter
   * @param options Configuration options
   */
  constructor(options: AnthropicToOpenAIAdapterOptions = {}) {
    super();
    this.options = options;
  }

  /**
   * Map Claude role to OpenAI role
   * @param claudeRole Role in Claude format
   * @returns Role in OpenAI format
   */
  private mapRole(claudeRole: string): ChatCompletionRole {
    switch (claudeRole) {
      case 'user':
        return 'user';
      case 'assistant':
        return 'assistant';
      case 'human':
        return 'user';
      default:
        return 'system';
    }
  }

  /**
   * Map Anthropic model name to OpenAI model name
   * @param claudeModel Model name in Claude format
   * @returns Model name in OpenAI format
   */
  private mapModel(claudeModel: string): string {
    if (this.options.modelMapping && this.options.modelMapping[claudeModel]) {
      return this.options.modelMapping[claudeModel];
    }
    return claudeModel;
  }

  /**
   * Map Claude messages to OpenAI messages
   * @param claudeMessages Messages in Claude format
   * @returns Messages in OpenAI format
   */
  public mapMessages(
    claudeMessages: ChatMessage[]
  ): ChatCompletionMessageParam[] {
    return claudeMessages.map((msg) => {
      const baseMessage = {
        role: this.mapRole(msg.sender),
        content: msg.text
      };

      // Only function messages require the name property
      if (baseMessage.role !== 'function') {
        return baseMessage as ChatCompletionMessageParam;
      } else {
        // For function messages, add the required name property
        return {
          ...baseMessage,
          name: 'default_function_name' // Replace with actual function name if available
        } as ChatCompletionMessageParam;
      }
    });
  }

  /**
   * Reset the state of the adapter
   */
  private reset(): void {
    this.accumulatedText.clear();
    this.messageId = null;
    this.model = null;
    this.created = Math.floor(Date.now() / 1000);
    this.stopReason = null;
    this.usageInfo = null;
    this.finishedBlocks.clear();
    this.startTime = Date.now();
  }

  /**
   * Convert Claude API response to an OpenAI Chat Completion response
   * @param claudeResponse Response from Claude API
   * @returns Response in OpenAI format
   */
  public convertToOpenAICompletion(claudeResponse: any): ChatCompletion {
    // Extract text content from text blocks
    const content = claudeResponse.content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .join('');

    // Find thinking blocks if any (for tool_calls)
    const thinkingBlocks = claudeResponse.content.filter(
      (block: any) => block.type === 'thinking'
    );

    // Create the base completion
    const completion: ChatCompletion = {
      id: claudeResponse.id,
      object: 'chat.completion',
      created: Math.floor(
        new Date(claudeResponse.created_at || Date.now()).getTime() / 1000
      ),
      model: this.mapModel(claudeResponse.model),
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: content,
            // Add tool_calls if thinking blocks exist
            ...(thinkingBlocks.length > 0 && {
              tool_calls: thinkingBlocks.map((block: any, index: number) => ({
                id: `call_thinking_${index}`,
                type: 'function',
                function: {
                  name: 'thinking',
                  arguments: JSON.stringify({ thoughts: block.thinking || '' })
                }
              }))
            })
          },
          finish_reason:
            this.mapStopReason(claudeResponse.stop_reason) || 'stop'
        }
      ],
      usage: claudeResponse.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    };

    return completion;
  }

  /**
   * Process an Anthropic streaming event and convert it to OpenAI format
   * @param event Event from Claude streaming API
   * @returns Converted event in OpenAI format, if applicable
   */
  public processEvent(event: SSEEvent): ChatCompletionChunk | null {
    if (this.options.debug) {
      console.debug('Processing Claude event:', event.type);
    }

    let chunk: ChatCompletionChunk | null = null;

    switch (event.type) {
      case 'message_start':
        chunk = this.handleMessageStart(event as MessageStartEvent);
        break;
      case 'content_block_start': {
        const startEvent = event as ContentBlockStartEvent;
        // Route to the appropriate handler based on content type
        if (startEvent.content_block.type === 'thinking') {
          chunk = this.handleThinkingBlockStart(startEvent);
        } else {
          chunk = this.handleContentBlockStart(startEvent);
        }
        break;
      }
      case 'content_block_delta': {
        const deltaEvent = event as ContentBlockDeltaEvent;
        // Route to the appropriate handler based on delta type
        if (deltaEvent.delta.type === 'thinking_delta') {
          chunk = this.handleThinkingDelta(deltaEvent);
        } else if (
          (deltaEvent.delta as any).type === 'thinking_summary_delta'
        ) {
          chunk = this.handleThinkingSummaryDelta(deltaEvent);
        } else if (deltaEvent.delta.type === 'text_delta') {
          chunk = this.handleContentBlockDelta(deltaEvent);
        }
        break;
      }
      case 'content_block_stop': {
        const stopEvent = event as ContentBlockStopEvent;
        // Get the block type from our tracking
        const blockType = this.blockTypes.get(stopEvent.index);
        if (blockType === 'thinking') {
          chunk = this.handleThinkingBlockStop(stopEvent);
        } else {
          chunk = this.handleContentBlockStop(stopEvent);
        }
        break;
      }
      case 'message_delta':
        chunk = this.handleMessageDelta(event as MessageDeltaEvent);
        break;
      case 'message_stop':
        chunk = this.handleMessageStop(event as MessageStopEvent);
        break;
      default:
        chunk = null;
    }

    // IMPORTANT: If we have a chunk, emit the 'chunk' event
    if (chunk) {
      this.emit('chunk', chunk);
      if (this.options.debug) {
        console.debug(
          'Emitted chunk:',
          JSON.stringify(chunk).substring(0, 100)
        );
      }
    }

    return chunk;
  }

  /**
   * Helper method to escape JSON strings
   * @param str String to escape
   * @returns Escaped string safe for JSON
   */
  private escapeJsonString(str: string): string {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }

  /**
   * Map Claude stop reason to OpenAI finish reason
   * @param claudeStopReason Stop reason in Claude format
   * @returns Finish reason in OpenAI format
   */
  private mapStopReason(
    claudeStopReason: string | null
  ):
    | 'stop'
    | 'length'
    | 'tool_calls'
    | 'content_filter'
    | 'function_call'
    | null {
    switch (claudeStopReason) {
      case 'end_turn':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'stop_sequence':
        return 'stop';
      case 'tool_use':
        return 'function_call';
      default:
        return null;
    }
  }

  /**
   * Handle the start of a thinking content block
   * Emits an OpenAI-compatible tool call for reasoning
   * @param event Content block start event with thinking type
   */
  private handleThinkingBlockStart(
    event: ContentBlockStartEvent
  ): ChatCompletionChunk | null {
    const { index, content_block } = event;
    const toolCallId = `call_thinking_${index}`;

    // Store the block type for later reference
    this.blockTypes.set(index, content_block.type);

    // Initialize thinking content from the content_block
    // Note: content_block.thinking may not exist in the type definition
    // so we need to access it safely
    const initialThinking = (content_block as any).thinking || '';
    this.accumulatedText.set(`thinking_${index}`, initialThinking);

    // Create the initial tool call chunk
    const chunk: ChatCompletionChunk = {
      id: this.messageId || `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: this.created,
      model: this.model || 'claude',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: toolCallId,
                type: 'function',
                function: {
                  name: 'thinking',
                  arguments:
                    '{"thoughts":"' + this.escapeJsonString(initialThinking)
                }
              }
            ]
          },
          finish_reason: null
        }
      ]
    };

    return chunk;
  }

  /**
   * Handle delta updates to thinking content blocks
   * @param event Content block delta event with thinking_delta type
   */
  private handleThinkingDelta(
    event: ContentBlockDeltaEvent
  ): ChatCompletionChunk | null {
    const { index, delta } = event;

    // Check if it's a thinking delta (safely handle type differences)
    if (delta.type !== 'thinking_delta' || !delta.thinking) {
      return null;
    }

    const toolCallId = `call_thinking_${index}`;

    // Update accumulated thinking text
    const currentThinking = this.accumulatedText.get(`thinking_${index}`) || '';
    this.accumulatedText.set(
      `thinking_${index}`,
      currentThinking + delta.thinking
    );

    // Create a tool call delta chunk with the new thinking content
    const chunk: ChatCompletionChunk = {
      id: this.messageId || `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: this.created,
      model: this.model || 'claude',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: toolCallId,
                function: {
                  arguments: this.escapeJsonString(delta.thinking)
                }
              }
            ]
          },
          finish_reason: null
        }
      ]
    };

    if (chunk && chunk.choices[0].delta.tool_calls) {
      console.log(
        'THINKING TOOL CALL EMITTED:',
        JSON.stringify(chunk.choices[0].delta.tool_calls[0])
      );
    }

    return chunk;
  }

  /**
   * Handle thinking summary deltas
   * These are special thinking deltas that contain summarized thinking
   */
  private handleThinkingSummaryDelta(
    event: ContentBlockDeltaEvent
  ): ChatCompletionChunk | null {
    const { index, delta } = event;

    // Since TypeScript doesn't recognize thinking_summary_delta,
    // we need to cast and access properties carefully
    const summaryDelta = delta as any;
    if (!summaryDelta.summary || !summaryDelta.summary.summary) {
      return null;
    }

    const toolCallId = `call_thinking_${index}`;
    const summaryText = `[SUMMARY: ${summaryDelta.summary.summary}]`;

    // Update accumulated thinking text with the summary
    const currentThinking = this.accumulatedText.get(`thinking_${index}`) || '';
    this.accumulatedText.set(
      `thinking_${index}`,
      currentThinking + '\n' + summaryText
    );

    // Create a tool call delta chunk with the summary
    const chunk: ChatCompletionChunk = {
      id: this.messageId || `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: this.created,
      model: this.model || 'claude',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: toolCallId,
                function: {
                  arguments: this.escapeJsonString('\n' + summaryText)
                }
              }
            ]
          },
          finish_reason: null
        }
      ]
    };

    return chunk;
  }

  /**
   * Handle the end of a thinking content block
   * @param event Content block stop event for a thinking block
   */
  private handleThinkingBlockStop(
    event: ContentBlockStopEvent
  ): ChatCompletionChunk | null {
    const { index } = event;
    const toolCallId = `call_thinking_${index}`;

    // Close the JSON object for the arguments
    const closingArguments = '"}';

    // Create the final chunk that completes the tool call
    const chunk: ChatCompletionChunk = {
      id: this.messageId || `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: this.created,
      model: this.model || 'claude',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: toolCallId,
                function: {
                  arguments: closingArguments
                }
              }
            ]
          },
          finish_reason: null
        }
      ]
    };

    return chunk;
  }

  /**
   * Handle the start of a message
   * @param event Message start event
   * @returns OpenAI compatible chunk
   */
  private handleMessageStart(event: MessageStartEvent): ChatCompletionChunk {
    // Reset the state for new message
    this.reset();
    this.initializeBlockTracking();

    this.messageId = event.message.id;
    this.model = this.mapModel(event.message.model);
    this.created = Math.floor(Date.now() / 1000);

    // Initial event with empty content
    return {
      id: this.messageId,
      object: 'chat.completion.chunk',
      created: this.created,
      model: this.model,
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            content: ''
          },
          finish_reason: null
        }
      ]
    };
  }

  /**
   * Handle the start of a content block
   * @param event Content block start event
   * @returns OpenAI compatible chunk or null
   */
  private handleContentBlockStart(
    event: ContentBlockStartEvent
  ): ChatCompletionChunk | null {
    const { index, content_block } = event;

    // Store the block type for later reference
    this.blockTypes.set(index, content_block.type);

    // Only handle text blocks for content output
    if (content_block.type === 'text') {
      // Initialize accumulated text for this block
      this.accumulatedText.set(`text_${index}`, content_block.text || '');

      // If there's initial text, emit a chunk for it
      if (content_block.text) {
        return {
          id: this.messageId || `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: this.created,
          model: this.model || 'claude',
          choices: [
            {
              index: 0,
              delta: {
                content: content_block.text
              },
              finish_reason: null
            }
          ]
        };
      }
    }

    return null;
  }

  /**
   * Handle delta updates to content blocks
   * @param event Content block delta event
   * @returns OpenAI compatible chunk or null
   */
  private handleContentBlockDelta(
    event: ContentBlockDeltaEvent
  ): ChatCompletionChunk | null {
    const { index, delta } = event;

    // Only process text deltas
    if (delta.type !== 'text_delta' || !delta.text) {
      return null;
    }

    // Get the current accumulated text for this block
    const currentText = this.accumulatedText.get(`text_${index}`) || '';

    // Update accumulated text
    this.accumulatedText.set(`text_${index}`, currentText + delta.text);

    // Emit an OpenAI-style chunk with just the delta
    return {
      id: this.messageId || `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: this.created,
      model: this.model || 'claude',
      choices: [
        {
          index: 0,
          delta: {
            content: delta.text
          },
          finish_reason: null
        }
      ]
    };
  }

  /**
   * Initialize block tracking during message_start event
   * This ensures we start clean with each new message
   */
  private initializeBlockTracking(): void {
    this.blockTypes.clear();
    this.accumulatedText.clear();
    this.finishedBlocks.clear();
  }

  /**
   * Handle the end of a content block
   * @param event Content block stop event
   * @returns OpenAI compatible chunk or null
   */
  private handleContentBlockStop(
    event: ContentBlockStopEvent
  ): ChatCompletionChunk | null {
    const { index } = event;

    // Mark this block as finished
    this.finishedBlocks.add(index);

    return null;
  }

  /**
   * Handle updates to message metadata
   * @param event Message delta event
   * @returns OpenAI compatible chunk or null
   */
  private handleMessageDelta(
    event: MessageDeltaEvent
  ): ChatCompletionChunk | null {
    const { delta, usage } = event;

    // Update stop reason
    this.stopReason = delta.stop_reason;

    // Update usage info if provided
    if (usage) {
      this.usageInfo = {
        prompt_tokens: 0, // Not directly provided by Claude
        completion_tokens: usage.output_tokens,
        total_tokens: usage.output_tokens // We don't have input tokens here
      };
    }

    // Don't emit a chunk for metadata updates
    return null;
  }

  /**
   * Handle the message stop event and finish the conversation
   */
  private handleMessageStop(event: MessageStopEvent): ChatCompletionChunk {
    // Map to one of the specific finish reasons OpenAI allows
    const finishReason = this.mapStopReason(this.stopReason);

    // Emit final chunk with finish reason
    return {
      id: this.messageId || `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: this.created,
      model: this.model || 'claude',
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: finishReason
        }
      ],
      usage: this.usageInfo
    };
  }

  /**
   * Convert Anthropic Messages API request to OpenAI Chat Completion request
   * Handles the different message types correctly
   */
  public convertAnthropicToOpenAIRequest(anthropicRequest: any): any {
    const messages: ChatCompletionMessageParam[] = [];

    // Add system prompt if provided
    if (anthropicRequest.system) {
      messages.push({
        role: 'system',
        content: anthropicRequest.system
      } as ChatCompletionMessageParam);
    }

    // Add user and assistant messages
    if (Array.isArray(anthropicRequest.messages)) {
      anthropicRequest.messages.forEach((msg: any) => {
        const role = this.mapRole(msg.role);
        const content =
          typeof msg.content === 'string'
            ? msg.content
            : msg.content.map((c: any) => c.text).join('');

        if (role === 'function') {
          // Function messages require a name
          messages.push({
            role,
            content,
            name: msg.name || 'default_function_name'
          } as ChatCompletionMessageParam);
        } else {
          // Other message types
          messages.push({
            role,
            content
          } as ChatCompletionMessageParam);
        }
      });
    }

    // Create the OpenAI request object without attaching to ChatCompletionMessageParam directly
    const openAIRequest: any = {
      model: this.mapModel(anthropicRequest.model),
      messages,
      stream: anthropicRequest.stream,
      max_tokens: anthropicRequest.max_tokens,
      temperature: anthropicRequest.temperature,
      top_p: anthropicRequest.top_p
    };

    return openAIRequest;
  }

  /**
   * Process a Claude API stream and emit OpenAI-compatible events
   * @param stream Anthropic SSE stream
   */
  public async processStream(
    stream: ReadableStream<any> | AsyncIterable<ClaudeEvent>
  ): Promise<void> {
    try {
      // Reset state for new stream
      this.reset();

      // Handle different stream types
      if (Symbol.asyncIterator in stream) {
        // If it's an AsyncIterable
        for await (const event of stream as AsyncIterable<ClaudeEvent>) {
          const chunk = this.processEvent(event as SSEEvent);
          if (chunk) {
            this.emit('chunk', chunk);
          }
        }
      } else {
        // If it's a ReadableStream
        const reader = (stream as ReadableStream<any>).getReader();
        let done = false;

        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;

          if (!done && value) {
            const event = JSON.parse(value) as SSEEvent;
            const chunk = this.processEvent(event);
            if (chunk) {
              this.emit('chunk', chunk);
            }
          }
        }
      }

      // Emit a complete event when done
      this.emit('complete', {
        id: this.messageId || `chatcmpl-${Date.now()}`,
        created: this.created,
        model: this.model || 'claude',
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: Array.from(this.accumulatedText.values()).join('')
            },
            finish_reason: this.mapStopReason(this.stopReason)
          }
        ],
        usage: this.usageInfo
      });
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Create an async iterable that yields OpenAI compatible chunks from a Claude stream
   * @param stream Anthropic SSE stream
   * @returns AsyncIterable of OpenAI compatible chunks
   */
  public async *createOpenAICompatibleStream(
    stream: ReadableStream<any> | AsyncIterable<ClaudeEvent>
  ): AsyncIterable<ChatCompletionChunk> {
    // Create a promise that will resolve/reject based on events
    let resolveNextChunk: ((chunk: ChatCompletionChunk) => void) | null = null;
    let rejectNextChunk: ((error: Error) => void) | null = null;

    // Set up event listeners
    const getNextChunk = () => {
      return new Promise<ChatCompletionChunk>((resolve, reject) => {
        resolveNextChunk = resolve;
        rejectNextChunk = reject;
      });
    };

    // Handle events
    this.on('chunk', (chunk) => {
      if (resolveNextChunk) {
        resolveNextChunk(chunk);
        resolveNextChunk = null;
      }
    });

    this.on('error', (error) => {
      if (rejectNextChunk) {
        rejectNextChunk(error);
        rejectNextChunk = null;
      }
    });

    // Start processing the stream
    this.processStream(stream).catch((error) => {
      if (rejectNextChunk) {
        rejectNextChunk(error);
      }
    });

    try {
      // Yield chunks as they arrive
      while (true) {
        const chunk = await getNextChunk();
        yield chunk;

        // If this is the final chunk with a finish_reason, stop
        if (chunk.choices[0].finish_reason) {
          break;
        }
      }
    } finally {
      // Clean up event listeners
      this.removeAllListeners('chunk');
      this.removeAllListeners('error');
    }
  }
}

/**
 * Helper class to handle Anthropic streaming events and convert them to OpenAI format
 * This is a simpler version without the full adapter functionality
 */
export class AnthropicStreamProcessor {
  private buffer: string = '';
  private currentMessageId: string | null = null;
  private currentModel: string | null = null;
  private created: number = Date.now();

  /**
   * Process a single line from the SSE stream and convert to OpenAI format if applicable
   * @param line A line from the SSE stream
   * @returns OpenAI-compatible chunk or null if not applicable
   */
  public processLine(line: string): ChatCompletionChunk | null {
    // Skip empty lines or comments
    if (!line || line.trim() === '' || line.startsWith(':')) {
      return null;
    }

    // Handle SSE format
    if (line.startsWith('data: ')) {
      const data = line.slice(6); // Remove 'data: ' prefix

      // Handle end of stream
      if (data === '[DONE]') {
        return {
          id: this.currentMessageId || `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(this.created / 1000),
          model: this.currentModel || 'claude',
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: 'stop'
            }
          ]
        };
      }

      try {
        const event = JSON.parse(data);
        return this.processEvent(event);
      } catch (error) {
        console.error('Error parsing JSON from SSE:', error);
        return null;
      }
    }

    return null;
  }

  /**
   * Process a raw event object from the Anthropic API
   * @param event Event object from Anthropic
   * @returns OpenAI-compatible chunk or null if not applicable
   */
  private processEvent(event: any): ChatCompletionChunk | null {
    const eventType = event.type;

    switch (eventType) {
      case 'message_start': {
        this.currentMessageId = event.message.id;
        this.currentModel = event.message.model;
        this.created = Date.now();

        return {
          id: this.currentMessageId,
          object: 'chat.completion.chunk',
          created: Math.floor(this.created / 1000),
          model: this.currentModel,
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content: ''
              },
              finish_reason: null
            }
          ]
        };
      }

      case 'content_block_delta': {
        // Only handle text deltas
        if (event.delta.type === 'text_delta' && event.delta.text) {
          this.buffer += event.delta.text;

          return {
            id: this.currentMessageId || `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(this.created / 1000),
            model: this.currentModel || 'claude',
            choices: [
              {
                index: 0,
                delta: {
                  content: event.delta.text
                },
                finish_reason: null
              }
            ]
          };
        }
        return null;
      }

      case 'message_stop': {
        return {
          id: this.currentMessageId || `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(this.created / 1000),
          model: this.currentModel || 'claude',
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: 'stop'
            }
          ]
        };
      }

      default:
        return null;
    }
  }

  /**
   * Process a complete Anthropic SSE stream and convert to OpenAI compatible chunks
   * @param stream Readable or AsyncIterable containing SSE events
   * @returns AsyncIterable of OpenAI compatible chunks
   */
  public async *processStream(
    stream: ReadableStream<any> | AsyncIterable<string>
  ): AsyncGenerator<ChatCompletionChunk> {
    try {
      // Reset state
      this.buffer = '';
      this.currentMessageId = null;
      this.currentModel = null;
      this.created = Date.now();

      if (Symbol.asyncIterator in stream) {
        // Handle AsyncIterable
        for await (const chunk of stream as AsyncIterable<string>) {
          const lines = chunk.toString().split('\n');

          for (const line of lines) {
            const result = this.processLine(line);
            if (result) {
              yield result;
            }
          }
        }
      } else {
        // Handle ReadableStream
        const reader = (stream as ReadableStream<any>).getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep the last incomplete line in the buffer

          for (const line of lines) {
            const result = this.processLine(line);
            if (result) {
              yield result;
            }
          }
        }

        // Process any remaining data
        if (buffer) {
          const result = this.processLine(buffer);
          if (result) {
            yield result;
          }
        }
      }
    } catch (error) {
      console.error('Error processing Anthropic stream:', error);
      throw error;
    }
  }
}
