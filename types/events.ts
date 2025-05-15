import { RiverEvents, type EventMap } from 'river.ts';
import { type Payload, type PingEvent } from './claude';

export const eventsMap = new RiverEvents()
  .defineEvent('ping', { data: {} as Payload<'ping'> })
  .defineEvent('worker_register', {
    data: {} as Payload<'worker_register'>
  })
  .defineEvent('worker_update_active_conversation', {
    data: {} as Payload<'worker_update_active_conversation'>
  })
  .defineEvent('tab_focus', {
    data: {} as Payload<'tab_focus'>
  })
  .defineEvent('message_start', {
    data: {} as Payload<'message_start'>
  })
  .defineEvent('message_stop', {
    data: {} as Payload<'message_stop'>
  })
  //   error" | "content_block_start" | "content_block_delta" | "content_block_stop" | "message_delta" | "message_limit" | "conversations_list" | "conversation_detail" | "conversation_latest" | "conversation_title" | "chat_message_warning" | "new_conversation" | "new_chat_request"
  .defineEvent('content_block_start', {
    data: {} as Payload<'content_block_start'>
  })
  .defineEvent('content_block_delta', {
    data: {} as Payload<'content_block_delta'>
  })
  .defineEvent('content_block_stop', {
    data: {} as Payload<'content_block_stop'>
  })
  .defineEvent('message_delta', {
    data: {} as Payload<'message_delta'>
  })
  .defineEvent('message_limit', {
    data: {} as Payload<'message_limit'>
  })
  .defineEvent('conversations_list', {
    data: {} as Payload<'conversations_list'>
  })
  .defineEvent('conversation_detail', {
    data: {} as Payload<'conversation_detail'>
  })
  .defineEvent('conversation_latest', {
    data: {} as Payload<'conversation_latest'>
  })
  .defineEvent('conversation_title', {
    data: {} as Payload<'conversation_title'>
  })
  .defineEvent('chat_message_warning', {
    data: {} as Payload<'chat_message_warning'>
  })
  .defineEvent('new_conversation', {
    data: {} as Payload<'new_conversation'>
  })
  .defineEvent('new_chat_request', {
    data: {} as Payload<'new_chat_request'>
  })
  .defineEvent('error', {
    data: {} as Payload<'error'>
  })
// Add other event types as needed

export const events = eventsMap.build();
export type Events = Omit<ReturnType<typeof eventsMap.build>, 'close' | 'open'>;
export type RiverEventTypes = keyof Events;