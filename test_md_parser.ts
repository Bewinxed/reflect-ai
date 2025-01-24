import type { BunFile } from "bun";
import type { ChatConversation } from "./types/claude";

export enum ContentType {
	Text = "text",
	ToolResult = "tool_result",
	ToolUse = "tool_use",
}

type Position = {
	line: number; // 0-based line number
	column: number; // 0-based column number
	offset: number; // 0-based character offset from start
};

interface PositionRange {
	start: Position;
	end: Position;
}

type MessageContentBlock = {
	index: number;
	type: ContentType;
	content: string;
	position: PositionRange;
};

type ConversationMessage = {
	uuid: string;
	generated: string;
	position: PositionRange;
	content: MessageContentBlock[];
};

class ConversationWriter {
	private messages: Map<string, ConversationMessage> = new Map();
	private text = "";
	private currentMessage: ConversationMessage | null = null;
	private currentBlock: MessageContentBlock | null = null;
	private blockIndexCounter = 0;
	metadata: Partial<ChatConversation> = {};
	private inFrontMatter = false;
	private inMessage = false;

	private parseComment(comment: string): [string, string] {
		const colonIndex = comment.indexOf("=");
		return [
			comment.slice(0, colonIndex).trim(),
			comment.slice(colonIndex + 1).trim(),
		];
	}

	getMessage(uuid: string) {
		const message = this.messages.get(uuid);
		if (!message) {
			throw new Error(`Message with UUID ${uuid} not found`);
		}
		return message;
	}

	getMessageBlock(
		messageId: string,
		blockIndex: number
	): MessageContentBlock | undefined {
		return this.getMessage(messageId)?.content.find(
			(b) => b.index === blockIndex
		);
	}

	async replaceMessageBlockContent(
		messageId: string,
		blockIndex: number,
		newContent: string
	): Promise<void> {
		const block = this.getMessageBlock(messageId, blockIndex);
		if (!block) {
			throw new Error(
				`Block with index ${blockIndex} not found in message ${messageId}`
			);
		}

		const oldLength = block.content.length;
		const newLength = newContent.length;
		const delta = newLength - oldLength;

		// Simple text splice
		this.text =
			this.text.slice(0, block.position.start.offset) +
			newContent +
			this.text.slice(block.position.end.offset);

		// Update just the critical position data
		block.content = newContent;
		block.position.end.offset = block.position.start.offset + newLength;

		// Fast offset-only updates for subsequent blocks
		const message = this.getMessage(messageId);
		for (let i = blockIndex + 1; i < message.content.length; i++) {
			const nextBlock = message.content[i];
			nextBlock.position.start.offset += delta;
			nextBlock.position.end.offset += delta;
		}

		// Only update message end if needed
		if (blockIndex === message.content.length - 1) {
			message.position.end.offset += delta;
		}
	}

	async parse(file?: BunFile) {
		this.text = (await file?.text()) || this.text;
		const lines = this.text.split("\n");
		let currentLine = 0;
		let currentOffset = 0;

		for (const line of lines) {
			const lineLength = line.length;
			const hasNewline = currentLine < lines.length - 1;
			const totalLineLength = lineLength + (hasNewline ? 1 : 0);

			// Handle separators differently based on context
			if (line.trim() === "---") {
				if (!this.inFrontMatter && currentLine === 0) {
					// Start of front matter
					this.inFrontMatter = true;
				} else if (this.inFrontMatter) {
					// End of front matter
					this.inFrontMatter = false;
					this.inMessage = false;
				} else {
					// Message separator - reset current message state
					this.inMessage = false;
					this.currentMessage = null;
					this.currentBlock = null;
				}
				currentOffset += totalLineLength;
				currentLine++;
				continue;
			}

			if (this.inFrontMatter) {
				this.parseFrontMatterLine(line);
			} else {
				const commentMatch = line.match(/^\[\/\/\]: # "(.+)"$/);
				if (commentMatch) {
					this.parseMetadataLine(
						commentMatch[1],
						currentLine,
						currentOffset,
						line
					);
					if (commentMatch[1].startsWith("message_uuid")) {
						this.inMessage = true;
					}
				} else if (this.inMessage && this.currentBlock) {
					this.parseContentLine(line, currentLine, currentOffset, lineLength);
				}
			}

			currentOffset += totalLineLength;
			currentLine++;
		}

		return {
			metadata: this.metadata,
			messages: this.messages,
		};
	}

	private parseFrontMatterLine(line: string): void {
		const [key, value] = line.split(":").map((s) => s.trim());
		if (key && value) this.metadata[key] = value;
	}

	private parseMetadataLine(
		commentContent: string,
		lineNumber: number,
		offset: number,
		line: string // Add this parameter
	): void {
		const [key, value] = this.parseComment(commentContent);
		const quoteStart = line.indexOf('"');
		const quoteEnd = line.lastIndexOf('"');

		const position: PositionRange = {
			start: {
				line: lineNumber,
				column: quoteStart + 1, // +1 to skip opening quote
				offset: offset + quoteStart + 1,
			},
			end: {
				line: lineNumber,
				column: quoteEnd,
				offset: offset + quoteEnd,
			},
		};

		switch (key) {
			case "message_uuid":
				this.currentBlock = null;

				this.currentMessage = {
					uuid: value,
					generated: "",
					content: [],
					position: {
						start: { ...position.start },
						end: { ...position.end },
					},
				};
				this.messages.set(value, this.currentMessage);

				break;

			case "generated":
				if (this.currentMessage) {
					// Remove trailing underscore from the sample data
					this.currentMessage.generated = value.replace(/_$/, "");
					this.currentMessage.position.end = position.end;
				}
				break;

			case "blocktype":
				if (this.currentMessage) {
					this.currentBlock = {
						index: this.blockIndexCounter++,
						type: value as ContentType,
						content: "",
						position: {
							start: { ...position.start },
							end: { ...position.end },
						},
					};
					this.currentMessage.content.push(this.currentBlock);
				}
				break;
		}
	}

	private parseContentLine(
		line: string,
		lineNumber: number,
		offset: number,
		lineLength: number
	): void {
		if (!this.currentBlock) return;

		// Preserve original line content including whitespace
		this.currentBlock.content += `${
			this.currentBlock.content ? "\n" : ""
		}${line}`;

		// Update positions
		this.currentBlock.position.end = {
			line: lineNumber,
			column: lineLength,
			offset: offset + lineLength,
		};

		if (this.currentMessage) {
			this.currentMessage.position.end = this.currentBlock.position.end;
		}
	}

	render(): string {
		let output = "---\n";

		// Front matter
		for (const [key, value] of Object.entries(this.metadata)) {
			output += `${key}: ${value}\n`;
		}
		output += "---\n\n";

		// Messages
		for (const message of this.messages.values()) {
			output += `[//]: # (message_uuid = ${message.uuid})\n`;
			output += `[//]: # (generated = ${message.generated})\n\n`;

			for (const block of message.content) {
				output += `[//]: # (blocktype = ${block.type})\n`;
				output += `${block.content}\n\n`;
			}

			output += "---\n";
		}

		return output;
	}
}

const conv = new ConversationWriter();
const file = Bun.file(
	"./server/conversations/5c05a54b-73c1-48ac-9f97-23faf4b48941.md"
);
const time = Date.now();
await conv.parse(
	Bun.file("./server/conversations/5c05a54b-73c1-48ac-9f97-23faf4b48941.md")
);
console.log(`Parsed in ${Date.now() - time}ms`);
const message = conv.getMessage("063dcb2b-9a74-4ae0-b440-ecd11c2cfb88");
// console.log(conv.metadata);
conv.replaceMessageBlockContent(
	message.uuid,
	1,
	`Hi there!
    How are you doing today? Is there anything I can help 
    you with?`
);
// console.log(
// 	await file
// 		.text()
// 		.then((text) =>
// 			text.slice(message?.position.start.offset, message?.position.end.offset)
// 		)
// );
const out = await Bun.file(
	"./server/conversations/5c05a54b-73c1-48ac-9f97-23faf4b48941-rendered.md"
);
await out.write(conv.render());
// console.log(conv.render());
process.exit(0);
