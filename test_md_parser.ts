import { type BunFile, FileSink } from "bun";
import { PathLike } from "node:fs";
import type { ChatConversation } from "./types/claude";

export enum ContentType {
	Text = "text",
	ToolResult = "tool_result",
	ToolUse = "tool_use",
}

interface Position {
	line: number;
	column: number;
	offset: number;
}

type MessageContentBlock = {
	index: number;
	type: ContentType;
	content: string;
};

type ConversationMessage = {
	uuid: string;
	generated: string;
	position: Position;
	content: MessageContentBlock[];
};

class Counter {
	value = 0;
	increment() {
		return this.value++;
	}
	reset() {
		this.value = 0;
	}
	set(value: number) {
		this.value = value;
	}
	get current() {
		return this.value;
	}
}

class ConversationWriter {
	private messages: Map<string, ConversationMessage> = new Map();
	private currentMessage: Partial<ConversationMessage> | null = null;
	private currentBlock: Partial<MessageContentBlock> | null = null;
	private blockMap: Map<number, MessageContentBlock> = new Map();

	private blockIndex = 0;

	metadata: Partial<ChatConversation> = {};

	parseComment(comment: string) {
		const colonIndex = comment.indexOf("=");
		return [comment.slice(0, colonIndex), comment.slice(colonIndex + 1).trim()];
	}

	// Method to get a message by UUID
	getMessage(uuid: string): ConversationMessage | undefined {
		// console.log("messages", this.messages);
		return this.messages.get(uuid);
	}

	// Method to get a block by its index
	getMessageBlock(
		messageId: string,
		blockIndex: number
	): MessageContentBlock | undefined {
		const message = this.getMessage(messageId);
		if (!message) return undefined;
		return message.content.find((block) => block.index === blockIndex);
	}

	findMessageByBlockIndex(blockIndex: number): ConversationMessage | undefined {
		for (const message of this.messages.values()) {
			if (message.content.some((block) => block.index === blockIndex)) {
				return message;
			}
		}
		return undefined;
	}

	async parse(file: BunFile) {
		const text = await file.text();
		const lines = text.split("\n");

		let inFrontMatter = false;
		this.blockMap.clear(); // Clear block map before parsing

		for (const line of lines) {
			const trimmedLine = line.trim();

			if (trimmedLine === "---") {
				inFrontMatter = !inFrontMatter;
				continue;
			}

			if (inFrontMatter) {
				this.parseFrontMatterLine(trimmedLine);
				continue;
			}

			if (trimmedLine.startsWith("[//]: #")) {
				this.parseCommentLine(trimmedLine);
			} else if (trimmedLine) {
				this.handleContentLine(trimmedLine);
			}
		}

		return {
			metadata: this.metadata,
			messages: this.messages,
		};
	}

	private parseFrontMatterLine(line: string): void {
		const colonIndex = line.indexOf(":");
		if (colonIndex === -1) return;

		const [key, value] = [
			line.slice(0, colonIndex),
			line.slice(colonIndex + 1).trim(),
		];
		this.metadata[key] = value;
	}

	private parseCommentLine(line: string): void {
		const content = line.split("[//]: #").at(-1)?.trim().slice(1, -1);
		if (!content) return;
		// console.log(content);
		const [key, value] = this.parseComment(content);
		// console.log(key);
		if (key === "message_uuid") {
			this.currentMessage = { uuid: value, content: [] };
			this.messages.set(value, this.currentMessage as ConversationMessage);
		} else if (content.startsWith("generated")) {
			if (this.currentMessage) {
				this.currentMessage.generated = value;
			}
		} else if (content.startsWith("blocktype")) {
			this.currentBlock = {
				content: "",
				type: value as ContentType,
				index: this.blockIndex++,
			};
			if (this.currentMessage?.content) {
				this.currentMessage.content.push(
					this.currentBlock as MessageContentBlock
				);
				// Add block to blockMap
				this.blockMap.set(
					this.currentBlock.index,
					this.currentBlock as MessageContentBlock
				);
			}
		}
	}

	private handleContentLine(line: string): void {
		if (this.currentBlock) {
			this.currentBlock.content +=
				(this.currentBlock.content ? "\n" : "") + line;
		}
	}

	render(): string {
		let result = "---\n";
		for (const [key, value] of Object.entries(this.metadata)) {
			result += `${key}: ${value}\n`;
		}
		result += "---\n\n";
		for (const message of this.messages.values()) {
			result += `[//]: # (message_uuid = ${message.uuid})\n`;
			result += `[//]: # (generated = ${message.generated})\n\n`;
			for (const block of message.content) {
				result += `[//]: # (blocktype = ${block.type})\n`;
				result += `${block.content}\n`;
			}
		}
		return result;
	}
}

// test
const conv = new ConversationWriter();
await conv.parse(
	Bun.file("./server/conversations/5c05a54b-73c1-48ac-9f97-23faf4b48941.md")
);
console.log(conv.metadata);
console.log(conv.getMessage("c6453bf5-68ef-403c-931e-1512dfb3aa6c"));
await Bun.file(
	"./server/conversations/5c05a54b-73c1-48ac-9f97-23faf4b48941-rendered.md"
).write(conv.render());
