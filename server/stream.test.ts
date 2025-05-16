// test-server.ts
// Simple script to test your running completions API server

const SERVER_URL = "http://localhost:3002"; // Adjust to your server's address

async function testCompletions() {
    console.log("Testing basic completions endpoint...");

    try {
        const response = await fetch(`${SERVER_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "claude-3-sonnet-20240229",
                messages: [
                    { role: "user", content: "Hello, please introduce yourself in one sentence." }
                ],
                max_tokens: 100
            })
        });

        console.log(`Response status: ${response.status}`);
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Error: ${errorText}`);
            return;
        }

        const data = await response.json();
        console.log("\nBasic completion response:");
        console.log(`Content: "${data.choices[0].message.content}"`);
        console.log(`Finish reason: ${data.choices[0].finish_reason}`);
        console.log(`Model: ${data.model}`);
        console.log(`Tokens: ${JSON.stringify(data.usage)}`);
    } catch (error) {
        console.error("Error making request:", error);
    }
}

async function testStreamingCompletions() {
    console.log("\nTesting streaming completions endpoint...");

    try {
        const response = await fetch(`${SERVER_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "claude-3-sonnet-20240229",
                messages: [
                    { role: "user", content: "Count from 1 to 5 slowly, with each number on a new line." }
                ],
                max_tokens: 100,
                stream: true
            })
        });

        console.log(`Response status: ${response.status}`);
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Error: ${errorText}`);
            return;
        }

        console.log("\nStreaming chunks:");

        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error("Response body is null");
        }

        const decoder = new TextDecoder();
        let fullContent = '';
        let chunkCount = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const eventData = line.slice(6); // Remove 'data: ' prefix

                    if (eventData.trim() === '[DONE]') {
                        console.log("[Stream complete]");
                        continue;
                    }

                    if (eventData.trim()) {
                        chunkCount++;
                        try {
                            const parsedData = JSON.parse(eventData);
                            if (parsedData.choices && parsedData.choices[0].delta.content) {
                                const content = parsedData.choices[0].delta.content;
                                fullContent += content;
                                console.log(`Chunk ${chunkCount}: "${content}"`);
                            } else if (parsedData.choices && parsedData.choices[0].finish_reason) {
                                console.log(`[Finish reason: ${parsedData.choices[0].finish_reason}]`);
                            }
                        } catch (e) {
                            console.error("Error parsing JSON:", e);
                            console.log("Raw data:", eventData);
                        }
                    }
                }
            }
        }

        console.log("\nFull content from stream:");
        console.log(fullContent);

    } catch (error) {
        console.error("Error making streaming request:", error);
    }
}

async function testThinkingBlocks() {
    console.log("\nTesting thinking blocks conversion...");

    try {
        const response = await fetch(`${SERVER_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "claude-3-sonnet-20240229",
                messages: [
                    { role: "user", content: "What is 12 + 34 * 56? Think step by step." }
                ],
                max_tokens: 300,
                stream: true,
                thinking: {
                    enabled: true
                }
            })
        });

        console.log(`Response status: ${response.status}`);
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Error: ${errorText}`);
            return;
        }

        console.log("\nThinking blocks streaming:");

        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error("Response body is null");
        }

        const decoder = new TextDecoder();
        let fullContent = '';
        let fullThinking = '';
        let chunkCount = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const eventData = line.slice(6); // Remove 'data: ' prefix

                    if (eventData.trim() === '[DONE]') {
                        console.log("[Stream complete]");
                        continue;
                    }

                    if (eventData.trim()) {
                        chunkCount++;
                        try {
                            const parsedData = JSON.parse(eventData);

                            // Handle text content
                            if (parsedData.choices && parsedData.choices[0].delta.content) {
                                const content = parsedData.choices[0].delta.content;
                                fullContent += content;
                                console.log(`Text chunk: "${content}"`);
                            }
                            // Handle thinking tool calls
                            else if (parsedData.choices && parsedData.choices[0].delta.tool_calls) {
                                const toolCalls = parsedData.choices[0].delta.tool_calls;
                                if (toolCalls[0].function && toolCalls[0].function.arguments) {
                                    try {
                                        // This might be a partial JSON string
                                        const args = toolCalls[0].function.arguments;
                                        if (args.includes('"thoughts"')) {
                                            // Start of thinking JSON
                                            const match = args.match(/"thoughts":"([^"]*)$/);
                                            if (match && match[1]) {
                                                fullThinking += match[1];
                                                console.log(`Thinking chunk: "${match[1]}"`);
                                            }
                                        } else if (args === '"}') {
                                            // End of thinking JSON
                                            console.log("[End of thinking]");
                                        } else {
                                            // Middle of thinking content
                                            fullThinking += args;
                                            console.log(`Thinking chunk: "${args}"`);
                                        }
                                    } catch (e) {
                                        console.log("Partial thinking:", toolCalls[0].function.arguments);
                                    }
                                }
                            }
                            // Handle finish reason
                            else if (parsedData.choices && parsedData.choices[0].finish_reason) {
                                console.log(`[Finish reason: ${parsedData.choices[0].finish_reason}]`);
                            }
                        } catch (e) {
                            console.error("Error parsing JSON:", e);
                            console.log("Raw data:", eventData);
                        }
                    }
                }
            }
        }

        console.log("\nFull content from stream:");
        console.log(fullContent);

        console.log("\nFull thinking content:");
        console.log(fullThinking);

    } catch (error) {
        console.error("Error making thinking request:", error);
    }
}

async function testToolUse() {
    console.log("\nTesting tool use conversion...");

    try {
        const response = await fetch(`${SERVER_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "claude-3-sonnet-20240229",
                messages: [
                    { role: "user", content: "What's the weather in San Francisco?" }
                ],
                max_tokens: 300,
                stream: true,
                tools: [
                    {
                        name: "get_weather",
                        description: "Get current weather for a location",
                        input_schema: {
                            type: "object",
                            properties: {
                                location: {
                                    type: "string",
                                    description: "The city and state/country"
                                },
                                unit: {
                                    type: "string",
                                    enum: ["celsius", "fahrenheit"],
                                    description: "Temperature unit"
                                }
                            },
                            required: ["location"]
                        }
                    }
                ]
            })
        });

        console.log(`Response status: ${response.status}`);
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Error: ${errorText}`);
            return;
        }

        console.log("\nTool use streaming:");

        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error("Response body is null");
        }

        const decoder = new TextDecoder();
        let fullContent = '';
        let toolArgumentsBuffer = '';
        let toolName = '';
        let chunkCount = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const eventData = line.slice(6); // Remove 'data: ' prefix

                    if (eventData.trim() === '[DONE]') {
                        console.log("[Stream complete]");
                        continue;
                    }

                    if (eventData.trim()) {
                        chunkCount++;
                        try {
                            const parsedData = JSON.parse(eventData);

                            // Handle text content
                            if (parsedData.choices && parsedData.choices[0].delta.content) {
                                const content = parsedData.choices[0].delta.content;
                                fullContent += content;
                                console.log(`Text chunk: "${content}"`);
                            }
                            // Handle tool calls
                            else if (parsedData.choices && parsedData.choices[0].delta.tool_calls) {
                                const toolCalls = parsedData.choices[0].delta.tool_calls;

                                // Tool name
                                if (toolCalls[0].function && toolCalls[0].function.name) {
                                    toolName = toolCalls[0].function.name;
                                    console.log(`Tool name: ${toolName}`);
                                }

                                // Tool arguments
                                if (toolCalls[0].function && toolCalls[0].function.arguments !== undefined) {
                                    const args = toolCalls[0].function.arguments;
                                    toolArgumentsBuffer += args;
                                    console.log(`Tool args chunk: ${args}`);

                                    // Try to parse complete JSON when we have an opening and closing brace
                                    if (toolArgumentsBuffer.startsWith('{') && toolArgumentsBuffer.endsWith('}')) {
                                        try {
                                            const parsedArgs = JSON.parse(toolArgumentsBuffer);
                                            console.log("Complete tool arguments:", parsedArgs);
                                        } catch (e) {
                                            // Not complete JSON yet
                                        }
                                    }
                                }
                            }
                            // Handle finish reason
                            else if (parsedData.choices && parsedData.choices[0].finish_reason) {
                                console.log(`[Finish reason: ${parsedData.choices[0].finish_reason}]`);
                            }
                        } catch (e) {
                            console.error("Error parsing JSON:", e);
                            console.log("Raw data:", eventData);
                        }
                    }
                }
            }
        }

        console.log("\nTool use summary:");
        console.log(`Tool name: ${toolName}`);
        console.log(`Tool arguments: ${toolArgumentsBuffer}`);

        // Try to parse the complete arguments
        if (toolArgumentsBuffer) {
            try {
                if (!toolArgumentsBuffer.startsWith('{')) {
                    toolArgumentsBuffer = '{' + toolArgumentsBuffer;
                }
                if (!toolArgumentsBuffer.endsWith('}')) {
                    toolArgumentsBuffer += '}';
                }
                const parsedArgs = JSON.parse(toolArgumentsBuffer);
                console.log("Parsed tool arguments:", parsedArgs);
            } catch (e) {
                console.error("Could not parse complete tool arguments:", e);
            }
        }

    } catch (error) {
        console.error("Error making tool use request:", error);
    }
}

// Run all tests
async function runAllTests() {
    await testCompletions();
    await testStreamingCompletions();
    await testThinkingBlocks();
    await testToolUse();
    console.log("\nAll tests completed!");
}

// Run only specific test(s)
async function runTest(testName: string) {
    switch (testName) {
        case "basic":
            await testCompletions();
            break;
        case "streaming":
            await testStreamingCompletions();
            break;
        case "thinking":
            await testThinkingBlocks();
            break;
        case "tools":
            await testToolUse();
            break;
        default:
            console.error(`Unknown test: ${testName}`);
            console.log("Available tests: basic, streaming, thinking, tools");
    }
}

// Get test to run from command line args
const testToRun = process.argv[2];

if (testToRun) {
    console.log(`Running test: ${testToRun}\n`);
    await runTest(testToRun);
} else {
    console.log("Running all tests\n");
    await runAllTests();
}