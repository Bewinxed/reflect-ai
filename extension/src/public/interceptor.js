(() => {
    const originalFetch = window.fetch;

    window.fetch = async (input, init) => {
        if (typeof input === "string" && input.includes("/api/organizations/") && input.endsWith("completion")) {
            console.log("Intercepted Claude AI request:", input);

            const originalResponse = await originalFetch(input, init);

            // Clone the response so the page can still use it
            const clonedResponse = originalResponse.clone();

            // Process the original response body
            const reader = originalResponse.body?.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });

                    // Process buffer for SSE events
                    const events = buffer.split("\n\n");
                    buffer = events.pop() || ""; // Retain incomplete event

                    for (const event of events) {
                        const lines = event.split("\n");
                        const eventType = lines[0]?.split(": ")[1];
                        const eventData = lines[1]?.split(": ")[1];

                        if (eventType === "content_block_delta" && eventData) {
                            const delta = JSON.parse(eventData);
                            console.log("Text Delta:", eventData.delta);

                            // Dispatch custom event with delta text
                            window.dispatchEvent(
                                new CustomEvent("TextDeltaEvent", { detail: delta })
                            );
                        }
						if (eventType === 'content_block_stop') {
							console.log('Content block stop event');
							window.dispatchEvent(
								new CustomEvent("ContentBlockStopEvent")
							);
						}
						if (eventType === 'message_start') {
							console.log('Message start event');
							window.dispatchEvent(
								new CustomEvent("MessageStartEvent", { detail: JSON.parse(eventData) })
							);
						}
                    }
                }
            }

            // Return the cloned response to the page
            return clonedResponse;
        }

        return originalFetch(input, init);
    };
})();
