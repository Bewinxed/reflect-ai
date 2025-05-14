import type {
  ClaudeEvent,
  NewChatRequest,
  Payload
  // Assuming ChatMessage is part of NewChatRequest['data']['chat_messages']
  // and looks something like this:
  // ChatMessage, (if you have a specific type for elements in chat_messages)
} from '../../../types/claude'; // Adjust path as needed
import { RiverSocketAdapter } from 'river.ts/websocket';
import { events } from '../../../types/events';

// Define a basic ChatMessage type if not imported
interface ChatMessage {
  text: string;
  // Add other properties if they exist, e.g., sender, timestamp
}

// Constants
const WS_ENDPOINT = 'ws://127.0.0.1:3002/ws';
const RECONNECT_DELAY_MS = 1000;
const HEARTBEAT_INTERVAL_MS = 5000;
const TAB_TIMEOUT_MS = 15000; // Consider tab inactive after 15s without heartbeat
const PENDING_NEW_CHAT_DATA_KEY = 'claudeForwardPendingNewChatData';

const river = new RiverSocketAdapter(events);

// Generate a unique ID for this tab instance (will change on full page navigation)
const tabInstanceId = getPersistentTabInstanceId();

// State management
let isInitialized = false;
let ws: WebSocket | null = null;
let currentConversationId: string | null = null;
let reconnectTimer: number | null = null;
let heartbeatTimer: number | null = null;
let messageQueue: Payload[] = [];
let isNewTabPage = window.location.pathname === '/new';

// Debug utilities
function debugLog(type: string, message: string, data?: unknown): void {
  console.log(
    `%c[ClaudeForward ${type}]%c ${message}`,
    'color: blue; font-weight: bold',
    'color: black',
    data || ''
  ); // Also make available through the debug API if it exists

  // if (window.debug$?.next) {
  //   window.debug$.next({
  //     type,
  //     message,
  //     data
  //   });
  // }
}

// Debug API for window-level debugging
declare global {
  interface Window {
    debug$: {
      next: (data: { type: string; message: string; data?: unknown }) => void;
    };
  }
}

// Initialize debug API if not already present
if (!window.debug$) {
  window.debug$ = {
    next: (data) =>
      console.log(
        `%c[ClaudeForward ${data.type}]%c ${data.message}`,
        'color: blue; font-weight: bold',
        'color: black',
        data.data || ''
      )
  };
}

// Tab state types
interface TabState {
  tabId: string;
  conversationId: string | null;
  url: string;
  isNewTab: boolean;
  lastUpdate: number;
}

// Tab registry in localStorage
function registerTab(): void {
  try {
    const now = Date.now();
    const currentTabState: TabState = {
      tabId: tabInstanceId,
      conversationId: currentConversationId,
      url: window.location.href,
      isNewTab: isNewTabPage,
      lastUpdate: now
    };

    const tabRegistry = getTabRegistry();
    tabRegistry[tabInstanceId] = currentTabState;

    const staleTime = now - TAB_TIMEOUT_MS;
    Object.keys(tabRegistry).forEach((tabId) => {
      if (tabRegistry[tabId].lastUpdate < staleTime) {
        debugLog('TAB-CLEANUP', `Removing stale tab: ${tabId}`);
        delete tabRegistry[tabId];
      }
    });

    localStorage.setItem('claude_tab_registry', JSON.stringify(tabRegistry));

    const newTabCount = Object.values(tabRegistry).filter(
      (tab) => tab.isNewTab
    ).length;
    debugLog(
      'TAB-REGISTRY',
      `Active tabs: ${
        Object.keys(tabRegistry).length
      }, New tabs: ${newTabCount}`
    );
  } catch (error) {
    debugLog('TAB-REGISTRY-ERROR', 'Failed to register tab', error);
  }
}

function getTabRegistry(): Record<string, TabState> {
  try {
    const registryJson = localStorage.getItem('claude_tab_registry');
    return registryJson ? JSON.parse(registryJson) : {};
  } catch (error) {
    debugLog('TAB-REGISTRY-ERROR', 'Failed to read tab registry', error);
    return {};
  }
}

function startHeartbeat(): void {
  if (heartbeatTimer !== null) {
    window.clearInterval(heartbeatTimer);
  }
  registerTab();
  heartbeatTimer = window.setInterval(() => {
    registerTab();
  }, HEARTBEAT_INTERVAL_MS);
  debugLog('HEARTBEAT', 'Tab heartbeat started');
}

function stopHeartbeat(): void {
  if (heartbeatTimer !== null) {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  try {
    const tabRegistry = getTabRegistry();
    delete tabRegistry[tabInstanceId];
    localStorage.setItem('claude_tab_registry', JSON.stringify(tabRegistry));
  } catch (error) {
    debugLog('HEARTBEAT-ERROR', 'Failed to clean up tab registry', error);
  }
}

// WebSocket Management
function connectWebSocket() {
  if (
    ws?.readyState === WebSocket.OPEN ||
    ws?.readyState === WebSocket.CONNECTING
  ) {
    return;
  }

  try {
    debugLog('WS', `Connecting to WebSocket with tabId=${tabInstanceId}`);
    ws = new WebSocket(`${WS_ENDPOINT}?tabId=${tabInstanceId}`);

    ws.onopen = () => {
      debugLog('WS', 'Connection established');
      sendToWebSocket({
        type: 'worker_register',
        content: {
          type: 'worker_register',
          clientId: 'claude-extension',
          tabId: tabInstanceId,
          isWorker: isNewTabPage,
          pathname: window.location.pathname
        },
        conversation_uuid: currentConversationId,
        endpoint: 'register',
        url: window.location.href
      });
      while (messageQueue.length > 0) {
        const message = messageQueue.shift();
        if (message) sendToWebSocket(message);
      }
      sendToWebSocket({
        type: 'ping',
        content: { type: 'ping' }
      });
    };

    ws.onclose = (event) => {
      debugLog('WS', `Connection closed: ${event.code} ${event.reason}`);
      scheduleReconnect();
    };

    ws.onerror = (error) => {
      debugLog('WS-ERROR', 'WebSocket error', error);
    };

    ws.onmessage = handleIncomingMessage;
  } catch (error) {
    debugLog('WS-ERROR', 'Failed to create WebSocket connection', error);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer);
  }
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, RECONNECT_DELAY_MS);
  debugLog('WS', `Scheduled reconnect in ${RECONNECT_DELAY_MS}ms`);
}

function disconnectWebSocket() {
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
    debugLog('WS', 'Disconnected');
  }
}

function sendToWebSocket<T extends ClaudeEvent['type']>(payload: Payload<T>) {
  if (ws?.readyState === WebSocket.OPEN) {
    const enhancedPayload = {
      ...payload,
      tab_id: tabInstanceId,
      is_new_tab: isNewTabPage
    };
    ws.send(river.createMessage(payload.type, enhancedPayload));
    debugLog('WS-SEND', `Sent ${payload.type} event`);
  } else {
    messageQueue.push(payload);
    debugLog('WS-QUEUE', `Queued ${payload.type} event (not connected)`);
    if (ws?.readyState !== WebSocket.CONNECTING && !reconnectTimer) {
      connectWebSocket();
    }
  }
}

// Conversation ID management
function updateCurrentConversationId(id: string | null) {
  if (id === currentConversationId) {
    return;
  }
  const oldId = currentConversationId;
  currentConversationId = id;
  isNewTabPage = id === null && window.location.pathname === '/new';

  debugLog(
    'CONV-ID',
    `Conversation ID updated: ${oldId} -> ${id} (isNewTab: ${isNewTabPage})`
  );
  registerTab();

  if (id) {
    ws?.send(
      river.createMessage('worker_update_active_conversation', {
        type: 'worker_update_active_conversation',
        content: {
          type: 'worker_update_active_conversation',
          clientId: 'claude-extension',
          tabId: tabInstanceId,
          conversationId: id
        },
        conversation_uuid: id,
        endpoint: 'update_conversation',
        url: window.location.href
      })
    );
  }
}

// URL path utilities
function getConversationIdFromUrl(url: URL): string | null {
  if (url.pathname === '/new') {
    return null;
  }
  const pathSegments = url.pathname.split('/');
  const chatIndex = pathSegments.indexOf('chat');
  if (chatIndex !== -1 && chatIndex < pathSegments.length - 1) {
    return pathSegments[chatIndex + 1];
  }
  const chatConversationsSegment = pathSegments.findIndex(
    (segment) => segment === 'chat_conversations'
  );
  return chatConversationsSegment !== -1 &&
    chatConversationsSegment < pathSegments.length - 1
    ? pathSegments[chatConversationsSegment + 1]
    : null;
}

function extractConversationFromCurrentURL() {
  try {
    const currentUrl = new URL(window.location.href);
    if (currentUrl.pathname === '/new') {
      updateCurrentConversationId(null);
      debugLog('NAV', 'On /new page, no active conversation');
      return;
    }
    const convId = getConversationIdFromUrl(currentUrl);
    if (convId) {
      updateCurrentConversationId(convId);
      debugLog('NAV', `Found conversation in URL: ${convId}`);
    } else if (
      currentConversationId !== null &&
      currentUrl.pathname !== '/new'
    ) {
      // If URL no longer has a conv ID but we thought we were in one, nullify it
      // (unless we are navigating to /new, which is handled above)
      // This handles cases like navigating from a chat to a settings page
      // updateCurrentConversationId(null);
      // debugLog('NAV', 'No conversation in current URL, cleared active conversation');
    }
  } catch (error) {
    debugLog('NAV-ERROR', 'Error extracting conversation ID from URL', error);
  }
}

function addAuthIdToUrl(url: URL): URL {
  const modifiedUrl = new URL(url.href);
  if (currentConversationId) {
    modifiedUrl.searchParams.set('auth_id', currentConversationId);
  }
  return modifiedUrl;
}

// Process SSE streams
async function processStream(response: Response, url: string) {
  const reader = response.body?.getReader();
  if (!reader) {
    debugLog('STREAM-ERROR', 'No reader available for stream');
    return;
  }

  const urlObj = new URL(url);
  const decoder = new TextDecoder();
  let buffer = '';

  const streamConversationUuid = getConversationIdFromUrl(urlObj);
  if (streamConversationUuid) {
    updateCurrentConversationId(streamConversationUuid);
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      while (buffer.includes('\n\n')) {
        const eventEnd = buffer.indexOf('\n\n');
        const eventData = buffer.slice(0, eventEnd);
        buffer = buffer.slice(eventEnd + 2);

        let eventType: Payload['type'] = 'message_start'; // Default or a more generic stream type
        let dataContent = '';

        for (const line of eventData.split('\n')) {
          if (line.startsWith('event:')) {
            eventType = line.slice(6).trim() as Payload['type'];
          } else if (line.startsWith('data:')) {
            // Make sure to handle multi-line data if applicable
            dataContent += line.slice(5).trim();
          }
        }

        const conversation_uuid = getConversationIdFromUrl(urlObj); // Re-check or use streamConversationUuid

        if (!conversation_uuid) {
          debugLog(
            'STREAM-ERROR',
            'No conversation UUID found in stream URL for event',
            { url, eventType }
          );
          continue;
        }
        // Update current conversation ID if processing for a specific one
        updateCurrentConversationId(conversation_uuid);

        const jsonData = JSON.parse(dataContent);

        if (dataContent) {
          try {
            ws?.send;
            sendToWebSocket({
              ...jsonData,
              conversation_uuid,
              endpoint: urlObj.pathname.split('/').pop() || '',
              url,
              tab_id: tabInstanceId
            });
          } catch (error) {
            debugLog('SSE-PARSE-ERROR', 'Failed to parse SSE data', {
              eventType,
              data:
                dataContent.length > 100
                  ? dataContent.slice(0, 100) + '...'
                  : dataContent,
              error
            });
          }
        }
      }
    }
  } catch (error) {
    debugLog('STREAM-ERROR', 'Error processing stream', error);
    ws?.send(
      river.createMessage('error', {
        type: 'error',
        content: {
          type: 'error',
          message: `Stream processing error: ${(error as Error).message}`,
          cause: {
            status: 500,
            statusText: 'Internal Server Error',
            data: error
          }
        },
        conversation_uuid: streamConversationUuid,
        url,
        tab_id: tabInstanceId,
        is_new_tab: isNewTabPage,
        endpoint: 'stream_error'
      })
    );
  }
}

// Check if this tab should handle a new conversation request
function shouldHandleNewChatRequest(): boolean {
  if (isNewTabPage) {
    debugLog('NEW-CHAT', 'This is a /new tab, will handle new chat request');
    return true;
  }
  try {
    const tabRegistry = getTabRegistry();
    const newTabs = Object.values(tabRegistry).filter(
      (tab) => tab.isNewTab && tab.tabId !== tabInstanceId
    );

    if (newTabs.length === 0) {
      debugLog('NEW-CHAT', 'No other /new tabs available, will handle request');
      return true;
    } else {
      debugLog(
        'NEW-CHAT',
        `Found ${newTabs.length} other /new tabs, will not handle request`
      );
      return false;
    }
  } catch (error) {
    debugLog('NEW-CHAT-ERROR', 'Error checking for /new tabs', error);
    return true; // Fallback: attempt to handle if registry check fails
  }
}

// Handle incoming WebSocket messages
function handleIncomingMessage(event: MessageEvent<string>) {
  try {
    const claudeEvent: ClaudeEvent = JSON.parse(event.data);
    debugLog('WS-RECEIVE', `Received ${claudeEvent.type} event`, claudeEvent);

    if (claudeEvent.type === 'new_chat_request') {
      if (shouldHandleNewChatRequest()) {
        handleNewChatRequest(claudeEvent as NewChatRequest).catch((error) => {
          debugLog(
            'NEW-CHAT-ERROR',
            'Failed to handle new chat request from WS message',
            error
          );
        });
      } else {
        debugLog(
          'NEW-CHAT',
          'Ignoring new chat request as other /new tabs can handle it'
        );
      }
    } // Handle other event types as needed
  } catch (error) {
    debugLog('WS-MESSAGE-ERROR', 'Failed to parse incoming message', {
      data: event.data,
      error
    });
  }
}

// New helper function to handle DOM interaction for chat messages
async function processChatMessagesOnPage(
  chatMessages: ChatMessage[] | undefined
): Promise<void> {
  debugLog('PROCESS-CHAT', 'Processing chat messages on page.', chatMessages);
  if (!chatMessages || chatMessages.length === 0) {
    debugLog('PROCESS-CHAT', 'No messages to process.');
    return;
  }

  const proseMirrorElement = document.querySelector('.ProseMirror');
  if (!proseMirrorElement) {
    throw new Error('Could not find ProseMirror editor');
  }

  for (const message of chatMessages) {
    proseMirrorElement.insertAdjacentHTML(
      'beforeend',
      `<p>${message.text}</p>` // Ensure message.text is properly escaped if it can contain HTML
    );
  }
  debugLog('PROCESS-CHAT', 'Inserted message content into editor');

  let sendButton = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Send message"]'
  );

  let retries = 0;
  const maxRetries = 20; // 20 * 100ms = 2 seconds
  while ((!sendButton || sendButton.disabled) && retries < maxRetries) {
    debugLog(
      'BUTTON',
      `Waiting for send button to be enabled (attempt ${
        retries + 1
      }/${maxRetries})`
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    sendButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Send message"]'
    );
    retries++;
  }

  if (sendButton && !sendButton.disabled) {
    sendButton.click();
    debugLog('SEND', 'Clicked send button');
  } else {
    const errorMsg = 'Send button not found or is disabled after waiting';
    sendToWebSocket({
      type: 'error',
      content: { type: 'error', message: errorMsg }
    });
    throw new Error(errorMsg);
  }
}

// Handle new chat requests
async function handleNewChatRequest(event: NewChatRequest): Promise<void> {
  try {
    if (window.location.pathname !== '/new') {
      sessionStorage.setItem(
        PENDING_NEW_CHAT_DATA_KEY,
        JSON.stringify(event.data)
      );
      debugLog(
        'NEW-CHAT',
        'Storing chat data and navigating to /new page to handle request'
      );
      window.location.href = '/new'; // Navigation will cause script to reload
      return;
    }

    // Already on /new page or navigated to it
    // The data to process is from the current event.
    await processChatMessagesOnPage(event.data.chat_messages);
  } catch (error) {
    debugLog('NEW-CHAT-ERROR', 'Failed to handle new chat request', error);
    sendToWebSocket({
      type: 'error',
      content: {
        type: 'error',
        message: `Failed to handle new chat request: ${
          (error as Error).message
        }`
      }
    }); // Do not re-throw here if error is sent to WebSocket, or make sure caller handles it
  }
}

function getPersistentTabInstanceId(): string {
  const storageKey = 'claude_persistent_tab_id';
  let id = sessionStorage.getItem(storageKey);
  if (!id) {
    id = Math.random().toString(36).substring(2, 15);
    sessionStorage.setItem(storageKey, id);
  }
  return id;
}

// Intercept fetch requests to Claude API
function interceptFetchAPI() {
  const originalFetch = window.fetch;

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const url =
      input instanceof URL
        ? input
        : new URL(
            typeof input === 'string' ? input : (input as Request).url,
            window.location.origin
          );

    const urlConversationId = getConversationIdFromUrl(url);
    if (urlConversationId) {
      updateCurrentConversationId(urlConversationId);
    }

    const modifiedUrl = addAuthIdToUrl(url);
    const fetchInput =
      input instanceof Request
        ? new Request(modifiedUrl.href, { ...init, ...input }) // Spread init after input to allow overrides
        : modifiedUrl.href;

    if (url.pathname.endsWith('count')) {
      return originalFetch(fetchInput, init);
    }
    if (
      url.pathname.includes('/api/organizations/') &&
      url.pathname.includes('/chat_conversations')
    ) {
      try {
        const response = await originalFetch(fetchInput, init);
        const clonedResponse = response.clone();
        const pathSegments = url.pathname.split('/');
        const conversation_uuid = getConversationIdFromUrl(url); // Use consistent getter

        if (!response.ok) {
          let errorData = {
            message: `API error: ${response.status} ${response.statusText}`
          };
          try {
            const errorJson = await clonedResponse.json();
            errorData = { ...errorData, ...errorJson };
          } catch {
            errorData.message = await clonedResponse.text(); // fallback to text
          }

          sendToWebSocket({
            type: 'error',
            content: {
              type: 'error',
              message: `API Error: ${response.status} ${response.statusText}`,
              details: {
                status: response.status,
                statusText: response.statusText,
                data: errorData
              }
            },
            conversation_uuid: conversation_uuid,
            endpoint: pathSegments.pop() || '',
            url: url.href
          });
          return response;
        }

        if (
          url.pathname.endsWith('/completion') ||
          url.pathname.endsWith('/retry_completion')
        ) {
          processStream(clonedResponse, url.href).catch((error) => {
            debugLog(
              'STREAM-ERROR',
              'Failed to process stream from fetch',
              error
            );
            // Error already sent within processStream
          });
          return response;
        }

        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          try {
            const data = await clonedResponse.json();
            const isCreatingNewConversation =
              url.pathname.endsWith('/chat_conversations') &&
              init?.method === 'POST';

            if (
              isCreatingNewConversation &&
              response.status === 201 &&
              data?.uuid
            ) {
              debugLog(
                'NEW-CONV',
                `New conversation created with ID: ${data.uuid}`
              );
              updateCurrentConversationId(data.uuid);
            }

            let eventType: Payload['type'] = '';
            const lastPathSegment = pathSegments.pop() || '';

            if (isCreatingNewConversation && response.status === 201) {
              eventType = 'new_conversation';
            } else if (
              url.pathname.includes('/chat_conversations') &&
              conversation_uuid &&
              lastPathSegment === conversation_uuid &&
              init?.method === 'GET' &&
              response.status === 200
            ) {
              eventType = 'conversation_detail';
            } else if (lastPathSegment === 'latest') {
              eventType = 'conversation_latest';
              return response; // Skip forwarding these for now
            } else if (lastPathSegment === 'chat_message_warning') {
              eventType = 'chat_message_warning';
              return response; // Skip forwarding these
            } else if (url.pathname.endsWith('/title')) {
              eventType = 'conversation_title';
            } else if (
              url.pathname.endsWith('/chat_conversations') &&
              init?.method === 'GET'
            ) {
              eventType = 'conversations_list';
            }

            sendToWebSocket({
              type: eventType,
              content: {
                type: eventType, // Echo type in content for consistency
                data: Array.isArray(data) ? data.slice(0, 10) : data // Limit array data if necessary
              },
              conversation_uuid: conversation_uuid,
              endpoint: lastPathSegment,
              url: url.href
            });
          } catch (error) {
            debugLog('JSON-ERROR', 'Failed to process JSON response', {
              error,
              url: url.href
            });
            sendToWebSocket({
              type: 'error',
              content: {
                type: 'error',
                message: 'Failed to parse JSON response'
              },
              url: url.href
            });
          }
        }
        return response;
      } catch (error) {
        debugLog('FETCH-ERROR', 'API fetch error', { error, url: url.href });
        sendToWebSocket({
          type: 'error',
          content: { type: 'error', message: (error as Error).message },
          url: url.href
        });
        throw error; // Re-throw to ensure original fetch behavior on failure if not caught
      }
    }
    return originalFetch(fetchInput, init);
  };
}

// Monitor URL changes
function monitorURLChanges() {
  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    isNewTabPage = window.location.pathname === '/new';
    extractConversationFromCurrentURL();
    registerTab();
    debugLog(
      'NAV',
      `URL changed (pushState) to ${window.location.pathname} (isNewTab: ${isNewTabPage})`
    );
  };

  window.addEventListener('popstate', () => {
    isNewTabPage = window.location.pathname === '/new';
    extractConversationFromCurrentURL();
    registerTab();
    debugLog(
      'NAV',
      `URL changed (popstate) to ${window.location.pathname} (isNewTab: ${isNewTabPage})`
    );
  });
}

// Initialize the extension
function initialize() {
  if (isInitialized) return;

  isNewTabPage = window.location.pathname === '/new';
  debugLog(
    'INIT',
    `Tab instance initializing with ID: ${tabInstanceId} (isNewTab: ${isNewTabPage})`
  );

  if (isNewTabPage) {
    const pendingDataJson = sessionStorage.getItem(PENDING_NEW_CHAT_DATA_KEY);
    if (pendingDataJson) {
      sessionStorage.removeItem(PENDING_NEW_CHAT_DATA_KEY);
      try {
        const pendingData: NewChatRequest['data'] = JSON.parse(pendingDataJson);
        debugLog(
          'INIT',
          'Found pending new chat data from sessionStorage. Processing...',
          pendingData
        );
        // Wait a brief moment for the DOM to be more likely ready, especially the editor
        setTimeout(() => {
          processChatMessagesOnPage(pendingData.chat_messages).catch(
            (error) => {
              debugLog(
                'INIT-NEW-CHAT-ERROR',
                'Error processing stored new chat data',
                error
              );
              sendToWebSocket({
                type: 'error',
                content: {
                  type: 'error',
                  message: `Error processing stored new chat: ${
                    (error as Error).message
                  }`
                }
              });
            }
          );
        }, 100); // 100ms delay, adjust if needed
      } catch (error) {
        debugLog(
          'INIT-ERROR',
          'Failed to parse pending new chat data from sessionStorage',
          error
        );
      }
    }
  }

  startHeartbeat();
  extractConversationFromCurrentURL(); // Important to call after isNewTabPage is set and potential pending data processed

  document.addEventListener('visibilitychange', () => {
    const isVisible = document.visibilityState === 'visible';
    debugLog(
      'VISIBILITY',
      `Tab visibility changed: ${isVisible ? 'visible' : 'hidden'}`
    );
    registerTab();
    if (isVisible && currentConversationId) {
      sendToWebSocket({
        type: 'tab_focus',
        content: { active: true }, // Added type to content
        conversation_uuid: currentConversationId,
        endpoint: 'focus',
        url: window.location.href
      });
    }
  });

  interceptFetchAPI();
  monitorURLChanges();
  connectWebSocket();

  isInitialized = true;
  debugLog('INIT', 'Initialization complete.');
}

// Start the extension
initialize();

// Clean up on tab close
window.addEventListener('beforeunload', () => {
  stopHeartbeat();
  disconnectWebSocket();
  debugLog('CLEANUP', 'Tab closing, cleanup complete');
});
