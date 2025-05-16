// server/claude-openai-converter.ts
import { EventEmitter } from 'node:events';
import type {
  ChatCompletionChunk,
  ChatCompletionRole,
  ChatCompletion
} from 'openai/resources.mjs';

import type {
  MessageStartEvent,
  ContentBlockDeltaEvent,
  ContentBlockStopEvent,
  MessageDeltaEvent,
  MessageStopEvent,
  ContentBlockStartEvent,
  ClaudeEvent,
  ChatMessage,
  Payload
} from '../types/claude'; // Uses your existing types

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
  private usageInfo: any = null;
  private finishedBlocks: Set<number> = new Set();
  private startTime: number = Date.now();
  private blockTypes: Map<number, string> = new Map(); // Track block types
  private toolCallIds: Map<number, string> = new Map(); // Track tool call IDs
  private currentThinkingBlocks: Set<number> = new Set(); // Track active thinking blocks
  private currentToolUseBlocks: Set<number> = new Set(); // Track active tool use blocks
  private toolInputBuffers: Map<number, string> = new Map(); // Buffer for partial JSON

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
    this.blockTypes.clear();
    this.toolCallIds.clear();
    this.currentThinkingBlocks.clear();
    this.currentToolUseBlocks.clear();
    this.toolInputBuffers.clear();
  }

  /**
   * Process an Anthropic streaming event and convert it to OpenAI format
   * @param event Event from Claude streaming API
   * @returns Converted event in OpenAI format, if applicable
   */
  public processEvent(event: any): ChatCompletionChunk | null {
    if (this.options.debug) {
      console.debug('Processing Claude event:', event.type);
    }

    let chunk: ChatCompletionChunk | null = null;

    try {
      switch (event.type) {
        case 'message_start':
          chunk = this.handleMessageStart(event as MessageStartEvent);
          break;
        case 'content_block_start': {
          const startEvent = event as ContentBlockStartEvent;
          // Route to the appropriate handler based on content type
          if (startEvent.content_block.type === 'thinking') {
            chunk = this.handleThinkingBlockStart(startEvent);
            this.currentThinkingBlocks.add(startEvent.index);
          } else if (startEvent.content_block.type === 'tool_use') {
            chunk = this.handleToolUseBlockStart(startEvent);
            this.currentToolUseBlocks.add(startEvent.index);
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
          } else if (deltaEvent.delta.type === 'text_delta') {
            chunk = this.handleContentBlockDelta(deltaEvent);
          } else if (deltaEvent.delta.type === 'input_json_delta') {
            chunk = this.handleInputJsonDelta(deltaEvent);
          }
          break;
        }
        case 'content_block_stop': {
          const stopEvent = event as ContentBlockStopEvent;
          // Get the block type from our tracking
          const blockType = this.blockTypes.get(stopEvent.index);

          if (blockType === 'thinking') {
            chunk = this.handleThinkingBlockStop(stopEvent);
            this.currentThinkingBlocks.delete(stopEvent.index);
          } else if (blockType === 'tool_use') {
            chunk = this.handleToolUseBlockStop(stopEvent);
            this.currentToolUseBlocks.delete(stopEvent.index);
          } else {
            chunk = this.handleContentBlockStop(stopEvent);
          }

          // Mark block as finished
          this.finishedBlocks.add(stopEvent.index);
          break;
        }
        case 'message_delta':
          chunk = this.handleMessageDelta(event as MessageDeltaEvent);
          break;
        case 'message_stop':
          chunk = this.handleMessageStop(event as MessageStopEvent);
          break;
        case 'error': {
          const errorMessage = event.content?.message || 'Unknown error';
          console.error('Adapter received error event:', errorMessage);
          throw new Error(`Claude API error: ${errorMessage}`);
        }
        default:
          chunk = null;
      }
    } catch (error) {
      console.error('Error processing event:', error);
      throw error;
    }

    // If we have a chunk, emit the 'chunk' event
    if (chunk) {
      this.emit('chunk', chunk);
      if (this.options.debug) {
        console.debug(
          'Emitted chunk:',
          JSON.stringify(chunk).substring(0, 100) + '...'
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

    // Store the tool call ID for later reference
    this.toolCallIds.set(index, toolCallId);

    // Store the block type for later reference
    this.blockTypes.set(index, content_block.type);

    // Initialize thinking content from the content_block
    // Note: content_block.thinking is not in the interface but may be present
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
                  arguments: '{"thoughts":"' + this.escapeJsonString(initialThinking)
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

    // Check if it's a thinking delta
    if (delta.type !== 'thinking_delta' || !delta.thinking) {
      return null;
    }

    const toolCallId = this.toolCallIds.get(index) || `call_thinking_${index}`;

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
    const toolCallId = this.toolCallIds.get(index) || `call_thinking_${index}`;

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
   * Handle the start of a tool_use content block
   * @param event Content block start event with tool_use type
   */
  private handleToolUseBlockStart(
    event: ContentBlockStartEvent
  ): ChatCompletionChunk | null {
    const { index, content_block } = event;

    // Generate a tool call ID if not provided
    const toolCallId = content_block.id || `tool_call_${index}`;

    // Store the tool call ID for later reference
    this.toolCallIds.set(index, toolCallId);

    // Store the block type for later reference
    this.blockTypes.set(index, content_block.type);

    // Get tool details
    const toolName = content_block.name || '';

    // Initialize tool input buffer
    this.toolInputBuffers.set(index, '');

    // Initial JSON if input is already available
    let initialInput = '{}';
    if (content_block.input && Object.keys(content_block.input).length > 0) {
      try {
        initialInput = JSON.stringify(content_block.input);
        this.accumulatedText.set(`tool_input_${index}`, initialInput);
      } catch (e) {
        console.error('Error serializing initial tool input:', e);
      }
    }

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
                  name: toolName,
                  arguments: '{' // Open the JSON object
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
   * Handle input_json_delta for tool use blocks
   * @param event Content block delta event with input_json_delta type
   */
  private handleInputJsonDelta(
    event: ContentBlockDeltaEvent
  ): ChatCompletionChunk | null {
    const { index, delta } = event;

    // Check if it's an input json delta
    if (delta.type !== 'input_json_delta' || !delta.partial_json) {
      return null;
    }

    const toolCallId = this.toolCallIds.get(index) || `tool_call_${index}`;

    // Update buffered JSON
    const currentBuffer = this.toolInputBuffers.get(index) || '';
    const newBuffer = currentBuffer + delta.partial_json;
    this.toolInputBuffers.set(index, newBuffer);

    // Try to parse what we have so far - this is just for tracking
    try {
      // Need to wrap with {} for parsing, but just stored in buffer
      JSON.parse(`{${newBuffer}}`);
    } catch (e) {
      // This is fine - partial JSON doesn't need to be valid at every step
    }

    // Create a tool call delta chunk with the new input content
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
                  arguments: delta.partial_json
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
   * Handle the end of a tool_use content block
   * @param event Content block stop event for a tool_use block
   */
  private handleToolUseBlockStop(
    event: ContentBlockStopEvent
  ): ChatCompletionChunk | null {
    const { index } = event;
    const toolCallId = this.toolCallIds.get(index) || `tool_call_${index}`;

    // Close the JSON object
    const closingArguments = '}';

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

    // Check if any thinking or tool use blocks are still active
    const hasUnfinishedThinkingBlocks = this.currentThinkingBlocks.size > 0;
    const hasUnfinishedToolUseBlocks = this.currentToolUseBlocks.size > 0;

    // If there are unfinished blocks, we need to close them
    if (hasUnfinishedThinkingBlocks || hasUnfinishedToolUseBlocks) {
      for (const index of this.currentThinkingBlocks) {
        this.handleThinkingBlockStop({ type: 'content_block_stop', index, stop_timestamp: new Date().toISOString() });
      }

      for (const index of this.currentToolUseBlocks) {
        this.handleToolUseBlockStop({ type: 'content_block_stop', index, stop_timestamp: new Date().toISOString() });
      }
    }

    // Final finish reason should be tool_calls if we were using tools
    const finalFinishReason = hasUnfinishedToolUseBlocks
      ? 'tool_calls'
      : (this.stopReason === 'tool_use' ? 'tool_calls' : finishReason);

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
          finish_reason: finalFinishReason
        }
      ],
      usage: this.usageInfo
    };
  }

  /**
   * Convert a complete Claude message to an OpenAI formatted completion
   * Used for non-streaming responses
   */
  public convertToOpenAICompletion(message: any): ChatCompletion {
    // Extract text content blocks
    const textContent = message.content
      ?.filter((block: any) => block.type === 'text')
      .map((block: any) => block.text || '')
      .join('') || '';

    // Extract thinking blocks
    const thinkingBlocks = message.content
      ?.filter((block: any) => block.type === 'thinking') || [];

    // Extract tool use blocks
    const toolUseBlocks = message.content
      ?.filter((block: any) => block.type === 'tool_use') || [];

    // Default usage if not provided
    const usage = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    };

    // If we have usage information, use it
    if (message.usage) {
      usage.completion_tokens = message.usage.output_tokens || 0;
      usage.total_tokens = message.usage.output_tokens || 0;
    }

    // Determine finish reason
    const finishReason = this.mapStopReason(message.stop_reason) || 'stop';
    const hasToolUse = toolUseBlocks.length > 0;
    const finalFinishReason = hasToolUse ? 'tool_calls' : finishReason;

    // Build the completion
    const completion: ChatCompletion = {
      id: message.id || `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(new Date().getTime() / 1000),
      model: this.mapModel(message.model || 'claude'),
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: textContent,
          },
          finish_reason: finalFinishReason,
          logprobs: null
        }
      ],
      usage
    };

    // Add tool_calls if needed
    if (thinkingBlocks.length > 0 || toolUseBlocks.length > 0) {
      completion.choices[0].message.tool_calls = [];

      // Add thinking blocks as tool calls
      thinkingBlocks.forEach((block: any, idx: number) => {
        completion.choices[0].message.tool_calls!.push({
          id: block.id || `thinking_${idx}`,
          type: 'function',
          function: {
            name: 'thinking',
            arguments: JSON.stringify({ thoughts: block.thinking || '' })
          }
        });
      });

      // Add tool use blocks as tool calls
      toolUseBlocks.forEach((block: any, idx: number) => {
        completion.choices[0].message.tool_calls!.push({
          id: block.id || `tool_${idx}`,
          type: 'function',
          function: {
            name: block.name || 'unknown_tool',
            arguments: JSON.stringify(block.input || {})
          }
        });
      });
    }

    return completion;
  }
}