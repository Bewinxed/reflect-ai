import { Mutex } from "async-mutex";
import { Database } from "bun:sqlite";
import { and, asc, eq, max, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";
// Remove the existing initializeDatabase function and replace with:
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

function safeJsonParse(str: string): any | null {
	try {
		return JSON.parse(str);
	} catch (error) {
		console.error("JSON parse error:", error);
		return null;
	}
}
// Type definitions
export interface ChatConversation {
	uuid: string;
	name: string;
	summary: string;
	model: string | null;
	created_at: Date;
	updated_at: Date;
	settings: Settings;
	is_starred: boolean;
	current_leaf_message_uuid: string | null;
	project_uuid?: string | null;
	chat_messages?: ChatMessage[];
	project?: Project | null;
}

export interface Project {
	uuid: string;
	name: string;
}

export interface Settings {
	preview_feature_uses_artifacts: boolean | null;
	preview_feature_uses_latex: boolean | null;
	preview_feature_uses_citations: null;
	enabled_artifacts_attachments: boolean | null;
	enabled_turmeric: null;
	paprika_mode: null;
}

export interface ChatMessage {
	uuid: string;
	text: string;
	content: ChatMessageContent[];
	sender: Sender;
	index: number;
	created_at: Date;
	updated_at: Date;
	truncated: boolean;
	attachments: Attachment[];
	files: any[];
	files_v2: any[];
	sync_sources: any[];
	parent_message_uuid: string;
	stop_reason?: StopReason;
}

interface Attachment {
	id: string;
	message_uuid: string;
	file_name: string;
	file_size: number;
	file_type: string;
	extracted_content: string;
	created_at: string;
}

export interface Artifact {
	id: string;
	version_uuid: string;
	conversation_uuid?: string | null; // Added null type
	type?: string | null;
	title?: string | null;
	content: string;
	language?: string | null;
	status: "draft" | "valid" | "invalid" | "final";
	tool_use_id?: string | null;
	message_uuid?: string | null;
	created_at?: string;
	updated_at?: string;
}

export interface ChatMessageContent {
	type: ContentType;
	text?: string;
	name?: string;
	input?: Input;
	content?: ContentContent[];
	is_error?: boolean;
}

export interface ContentContent {
	type: ContentType;
	text: string;
}

export interface Input {
	id: string;
	type?: string;
	title?: string;
	command?: string;
	content?: string;
	language?: Language;
	version_uuid: string;
	new_str?: string;
	old_str?: string;
}

export enum ContentType {
	Text = "text",
	ToolResult = "tool_result",
	ToolUse = "tool_use",
}

export type Language = string;

export type InputType = "application/vnd.ant.code";

export type Name = "artifacts";

export type Sender = "human" | "assistant";

export enum StopReason {
	StopSequence = "stop_sequence",
}

interface ContentBlockTracker {
	index: number;
	type: ContentType;
	textContent: string;

	currentBlocks: Map<
		number,
		{
			index: number;
			type: ContentType;
			textContent: string;
			toolUseId?: string;
			toolResult?: string;
			fragments: string[];
			status: "pending" | "valid" | "invalid";
			replacedBy?: number;
			is_error?: boolean;
		}
	>;
	toolRelationships: Map<
		string,
		{
			toolUseIndex: number;
			toolResultIndex?: number;
			status: "pending" | "success" | "error";
		}
	>;
}

interface ContentBlock {
	index: number;
	content: string;
	type?: string;
	jsonParts?: string[];
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
		blockTracker: ContentBlockTracker; // New tracking system
	} | null;
	activeConversation: string | null;
}

// Constants and initialization
const sketchPath = "./sketch.md";
const sqlite = new Database("claude.db", {
	create: true,
});
sqlite.exec("PRAGMA foreign_keys = ON"); // Enable foreign key constraints

const db = drizzle(sqlite, { schema });
// Run migrations on startup
migrate(db, { migrationsFolder: "./drizzle" });

const messageMutex = new Mutex();
let sketchWriter = Bun.file(sketchPath).writer();
await sketchWriter.write("# Live Message Sketch\n\n");

interface ToolRelationship {
	toolUseId: string;
	resultIndex?: number;
	status: "pending" | "success" | "error";
}

// Enhanced conversation handler
// Updated conversation handler with proper date handling
async function handleConversationData(
	conversation_uuid: string,
	data: ChatConversation | ChatConversation[]
) {
	const convs = Array.isArray(data)
		? data
		: [
				{
					...data,
					conversation_uuid,
				},
		  ];
	const now = new Date().toISOString();

	for (const conv of convs) {
		console.log("[FK DEBUG] Processing conversation:", conversation_uuid);
		console.log(
			"[FK DEBUG] Current leaf message:",
			conv.current_leaf_message_uuid
		);
		console.log(
			"[FK DEBUG] Has messages?",
			conv.chat_messages?.length ?? 0
		);

		await db
			.insert(schema.conversations)
			.values({
				uuid: conv.uuid,
				name: conv.name || "",
				summary: conv.summary || "",
				model: conv.model || null,
				created_at:
					conv.created_at instanceof Date
						? conv.created_at.toISOString()
						: conv.created_at || now,
				updated_at:
					conv.updated_at instanceof Date
						? conv.updated_at.toISOString()
						: conv.updated_at || now,
				settings: conv.settings || {},
				is_starred: conv.is_starred,
				current_leaf_message_uuid:
					conv.current_leaf_message_uuid || null,
				project_uuid: conv.project_uuid || null,
			})
			.onConflictDoUpdate({
				target: schema.conversations.uuid,
				set: {
					name: conv.name || "",
					summary: conv.summary || "",
					model: conv.model || null,
					updated_at:
						conv.updated_at instanceof Date
							? conv.updated_at.toISOString()
							: conv.updated_at || now,
					settings: conv.settings || {},
					is_starred: conv.is_starred,
					current_leaf_message_uuid:
						conv.current_leaf_message_uuid || null,
					project_uuid: conv.project_uuid || null,
				},
			});

		if (conv.chat_messages) {
			for (const msg of conv.chat_messages) {
				await db
					.insert(schema.messages)
					.values({
						uuid: msg.uuid,
						conversation_uuid: conv.uuid,
						text: msg.text || "",
						sender: msg.sender || "unknown",
						index: msg.index || 0,
						created_at:
							msg.created_at instanceof Date
								? msg.created_at.toISOString()
								: msg.created_at || now,
						updated_at:
							msg.updated_at instanceof Date
								? msg.updated_at.toISOString()
								: msg.updated_at || now,
						truncated: msg.truncated,
						stop_reason: msg.stop_reason || null,
						parent_message_uuid: msg.parent_message_uuid,
						model: conv.model || null,
					})
					.onConflictDoUpdate({
						target: schema.messages.uuid,
						set: {
							text: msg.text || "",
							sender: msg.sender || "unknown",
							index: msg.index || 0,
							updated_at:
								msg.updated_at instanceof Date
									? msg.updated_at.toISOString()
									: msg.updated_at || now,
							truncated: msg.truncated,
							stop_reason: msg.stop_reason || null,
							parent_message_uuid: msg.parent_message_uuid || "",
							model: conv.model || null,
						},
					});
			}
		}
	}
}

// WebSocket server setup
Bun.serve<WebSocketData>({
	port: 3000,
	fetch(req, server) {
		if (server.upgrade(req)) return;
		return new Response("Not found", { status: 404 });
	},
	websocket: {
		async open(ws) {
			ws.data = {
				currentMessage: null,
				activeConversation: null,
			};
		},

		async message(ws, raw) {
			const release = await messageMutex.acquire();
			const payload = JSON.parse(raw.toString()) as {
				type: string;
				data: any;
				conversation_uuid: string;
				endpoint: string; // Add this
				url: string; // Add this
			};

			const { type, data, conversation_uuid, endpoint, url } = payload;
			const now = new Date().toISOString();

			try {
				switch (type) {
					case "conversation_title":
						await db
							.update(schema.conversations)
							.set({
								name: data.title,
							})
							.where(
								eq(schema.conversations.uuid, conversation_uuid)
							);
						break;
					case "conversations_list":
						console.log(
							"[DEBUG] Handling conversations_list with",
							data.length,
							"items"
						);
						await handleConversationData(conversation_uuid, data);
						break;

					case "conversation_detail":
						console.log(
							"[DEBUG] Handling conversation_detail:",
							data.uuid
						);
						await handleConversationData(conversation_uuid, [data]);
						ws.data.activeConversation = data.uuid;
						break;

					case "message_start": {
						// Initialize new message tracking
						ws.data.currentMessage = {
							id: data.message.uuid,
							conversation_uuid: conversation_uuid,
							contentBlocks: [],
							model: data.message.model,
							artifacts: [],
							created_at: new Date().toISOString(),
							currentBlockIndex: 0,
							activeCodeBlock: false,
							blockTracker: {
								index: 0,
								type: ContentType.Text,
								textContent: "",
								currentBlocks: new Map(),
								toolRelationships: new Map(),
							},
						};

						// Create initial message record
						await db.insert(schema.messages).values({
							uuid: data.message.uuid,
							conversation_uuid: conversation_uuid,
							model: data.message.model,
							sender: "assistant",
							created_at: now,
							updated_at: now,
						});
						await sketchWriter.write(
							`<!-- MESSAGE UUID: ${data.message.uuid} -->\n`
						);
						break;
					}

					case "message_delta": {
						if (ws.data.currentMessage?.blockTracker) {
							// Iterate through Map entries properly
							for (const [toolUseId, rel] of ws.data
								.currentMessage.blockTracker
								.toolRelationships) {
								if (rel.status === "success") {
									await db
										.update(schema.artifacts)
										.set({
											status: "final",
											updated_at:
												new Date().toISOString(),
										})
										.where(
											eq(
												schema.artifacts.tool_use_id,
												toolUseId
											)
										);
								}
							}
						}
						break;
					}

					case "content_block_start": {
						if (!ws.data.currentMessage?.blockTracker) break;
						const tracker = ws.data.currentMessage.blockTracker;
						const blockIndex = data.index;

						// Delete existing block content if any
						await db
							.delete(schema.messageContents)
							.where(
								and(
									eq(
										schema.messageContents.messageUuid,
										ws.data.currentMessage.id
									),
									eq(
										schema.messageContents.blockIndex,
										blockIndex
									)
								)
							);

						// Handle block replacements
						if (tracker.currentBlocks.has(blockIndex)) {
							const oldBlock =
								tracker.currentBlocks.get(blockIndex)!;
							oldBlock.status = "invalid";
							oldBlock.replacedBy = blockIndex;
							await sketchWriter.write(
								`\n<!-- REPLACING BLOCK ${blockIndex} -->\n`
							);
						}

						// Initialize new block
						const newBlock = {
							index: blockIndex,
							type: data.content_block.type as ContentType,
							textContent: "",
							toolUseId:
								data.content_block.type === ContentType.ToolUse
									? data.content_block.id ||
									  `tool_${crypto.randomUUID()}`
									: undefined,
							toolResult: undefined,
							fragments: [],
							status: "pending" as const,
							replacedBy: undefined,
							is_error: false,
						};

						tracker.currentBlocks.set(blockIndex, newBlock);

						// Track tool relationships
						if (newBlock.toolUseId) {
							tracker.toolRelationships.set(newBlock.toolUseId, {
								toolUseIndex: blockIndex,
								status: "pending",
							});
						}

						// Write block header
						let blockComment = `\n<!-- ${newBlock.type.toUpperCase()} BLOCK ${blockIndex}`;
						if (
							newBlock.type === ContentType.ToolUse &&
							newBlock.toolUseId
						) {
							blockComment += ` ID: ${newBlock.toolUseId}`;
						}
						blockComment += " -->\n";
						await sketchWriter.write(blockComment);
						break;
					}

					case "content_block_delta": {
						if (!ws.data.currentMessage) break;
						const block =
							ws.data.currentMessage.blockTracker.currentBlocks.get(
								data.index
							);
						if (!block) break;

						const fragmentSequence = block.fragments.length;
						const baseValues = {
							id: crypto.randomUUID(),
							messageUuid: ws.data.currentMessage.id,
							blockIndex: data.index,
							fragmentSequence,
							createdAt: now,
							updatedAt: now,
						};

						if (data.delta?.text) {
							await db.insert(schema.messageContents).values({
								...baseValues,
								contentType: ContentType.Text,
								textContent: data.delta.text,
							});
							block.fragments.push(data.delta.text);
							block.textContent += data.delta.text;
							await sketchWriter.write(data.delta.text);
						}

						if (data.delta?.partial_json) {
							await db.insert(schema.messageContents).values({
								...baseValues,
								contentType: ContentType.ToolUse,
								toolInput: data.delta.partial_json,
							});
							block.fragments.push(data.delta.partial_json);
							if (block.type === ContentType.ToolUse) {
								const relationship =
									ws.data.currentMessage.blockTracker.toolRelationships.get(
										block.toolUseId!
									);
								if (relationship) {
									relationship.status = "pending";
								}
							}
							await sketchWriter.write(data.delta.partial_json);
						}
						break;
					}

					case "content_block_stop": {
						if (!ws.data.currentMessage) break;
						const blockIndex = data.index;
						const block =
							ws.data.currentMessage.blockTracker.currentBlocks.get(
								blockIndex
							);
						if (!block) break;

						// Finalize text block
						if (block.type === ContentType.Text) {
							await db
								.update(schema.messageContents)
								.set({ isComplete: true })
								.where(
									eq(
										schema.messageContents.blockIndex,
										blockIndex
									)
								);
						}

						// Handle tool use completion
						if (block.type === ContentType.ToolUse) {
							try {
								const combinedJson = block.fragments.join("");
								const parsed = JSON.parse(combinedJson);

								await db.transaction(async (tx) => {
									await tx
										.update(schema.messageContents)
										.set({
											toolInput: parsed,
											isComplete: true,
											toolResult: null,
										})
										.where(
											eq(
												schema.messageContents
													.blockIndex,
												blockIndex
											)
										);

									await tx.insert(schema.artifacts).values({
										id: parsed.id,
										version_uuid:
											parsed.version_uuid ||
											crypto.randomUUID(),
										content: parsed.content,
										conversation_uuid:
											ws.data.currentMessage!
												.conversation_uuid,
										type: parsed.type,
										title: parsed.title,
										language: parsed.language,
										message_uuid:
											ws.data.currentMessage?.id,
										tool_use_id: block.toolUseId,
										status: "draft",
										created_at: now,
										updated_at: now,
									});
								});

								await sketchWriter.write(
									`\n\`\`\`${parsed.language}\n${parsed.content}\n\`\`\`\n`
								);
							} catch (error) {
								await sketchWriter.write(
									`\n<!-- INVALID TOOL USE BLOCK ${blockIndex} -->\n`
								);

								block.status = "invalid";
								await db
									.update(schema.messageContents)
									.set({ isComplete: false })
									.where(
										eq(
											schema.messageContents.blockIndex,
											blockIndex
										)
									);
							}
						}

						// Handle tool results (modified to use block type instead of data.content_block)
						if (block.type === ContentType.ToolResult) {
							const relationship =
								ws.data.currentMessage.blockTracker.toolRelationships.get(
									block.toolUseId!
								);

							if (relationship) {
								relationship.status = block.is_error
									? "error"
									: "success";
								relationship.toolResultIndex = blockIndex;

								await db.transaction(async (tx) => {
									await tx
										.update(schema.artifacts)
										.set({
											status: block.is_error
												? "invalid"
												: "valid",
											updated_at: now,
										})
										.where(
											eq(
												schema.artifacts.tool_use_id,
												block.toolUseId!
											)
										);

									await tx
										.update(schema.messageContents)
										.set({
											isComplete: true,
											toolResult:
												block.fragments.join(""),
											toolUseId: block.toolUseId,
										})
										.where(
											eq(
												schema.messageContents
													.blockIndex,
												blockIndex
											)
										);
								});
							}
						}
						break;
					}

					case "message_stop": {
						if (!ws.data.currentMessage) break;

						// Finalize all blocks and relationships
						await db.transaction(async (tx) => {
							// Cleanup invalid/replaced blocks
							for (const [index, block] of ws.data.currentMessage!
								.blockTracker.currentBlocks) {
								if (block.status !== "valid") {
									await tx
										.delete(schema.messageContents)
										.where(
											eq(
												schema.messageContents
													.blockIndex,
												index
											)
										);

									if (block.toolUseId) {
										await tx
											.delete(schema.artifacts)
											.where(
												eq(
													schema.artifacts
														.tool_use_id,
													block.toolUseId
												)
											);
									}
								}
							}

							// Assemble final message text from valid blocks
							const textBlocks = await tx
								.select({
									textContent:
										schema.messageContents.textContent,
									index: schema.messageContents.blockIndex,
								})
								.from(schema.messageContents)
								.where(
									and(
										eq(
											schema.messageContents.messageUuid,
											ws.data.currentMessage!.id
										),
										eq(
											schema.messageContents.contentType,
											ContentType.Text
										),
										eq(
											schema.messageContents.isComplete,
											true
										)
									)
								)
								.orderBy(
									asc(schema.messageContents.blockIndex)
								);

							const fullText = textBlocks
								.map((b) => b.textContent)
								.join("\n");

							// Update message record
							await tx
								.update(schema.messages)
								.set({
									text: fullText,
									updated_at: now,
									stop_reason:
										data.stop_reason ||
										StopReason.StopSequence,
								})
								.where(
									eq(
										schema.messages.uuid,
										ws.data.currentMessage!.id
									)
								);
						});

						// Finalize sketch file
						await sketchWriter.write(
							`\n<!-- MESSAGE COMPLETE: ${
								ws.data.currentMessage!.id
							} -->\n`
						);
						await sketchWriter.flush();
						ws.data.currentMessage = null;
						break;
					}

					case "message_stop": {
						if (!ws.data.currentMessage) break;
						// Finalize all blocks and relationships
						await db.transaction(async (tx) => {
							// Cleanup invalid/replaced blocks
							for (const [index, block] of ws.data.currentMessage!
								.blockTracker.currentBlocks) {
								if (block.status !== "valid") {
									await tx
										.delete(schema.messageContents)
										.where(
											eq(
												schema.messageContents
													.blockIndex,
												index
											)
										);

									if (block.toolUseId) {
										await tx
											.delete(schema.artifacts)
											.where(
												eq(
													schema.artifacts
														.tool_use_id,
													block.toolUseId
												)
											);
									}
								}
							}

							// Assemble final message text
							const textBlocks = await tx
								.select({
									textContent:
										schema.messageContents.textContent,
									index: schema.messageContents.blockIndex,
								})

								.from(schema.messageContents)
								.where(
									and(
										eq(
											schema.messageContents.messageUuid,
											ws.data.currentMessage!.id
										),
										eq(
											schema.messageContents.contentType,
											ContentType.Text
										),
										eq(
											schema.messageContents.isComplete,
											true
										)
									)
								)
								.orderBy(
									asc(schema.messageContents.blockIndex)
								);

							const fullText = textBlocks
								.map((b) => b.textContent)
								.join("\n");

							await tx
								.update(schema.messages)
								.set({
									text: fullText,
									updated_at: now,
								})
								.where(
									eq(
										schema.messages.uuid,
										ws.data.currentMessage!.id
									)
								);
						});

						// Finalize sketch file
						await sketchWriter.write(
							`\n<!-- MESSAGE COMPLETE: ${
								ws.data.currentMessage!.id
							} -->\n`
						);

						await sketchWriter.end();
						ws.data.currentMessage = null;
						break;
					}

					case "message_stop":
						if (ws.data.currentMessage) {
							await sketchWriter.end();

							await db
								.update(schema.messages)
								.set({ updated_at: now })
								.where(
									eq(
										schema.messages.uuid,
										ws.data.currentMessage.id
									)
								);
						}
						ws.data.currentMessage = null;
						break;

					case "message_limit":
						if (ws.data.currentMessage) {
							const textBlocks = Array.from(
								ws.data.currentMessage.blockTracker.currentBlocks.values()
							)
								.filter((b) => b.type === "text")
								.sort((a, b) => a.index - b.index);

							for (const block of textBlocks) {
								await sketchWriter.write(block.textContent);
							}

							// Write timestamp and close
							await sketchWriter.write(
								`\n_Generated at: ${now}_\n`
							);
							await sketchWriter.end();

							const fullContent: ChatMessageContent[] =
								ws.data.currentMessage.contentBlocks.map(
									(block) => {
										if (
											block.type ===
											ContentType.ToolResult
										) {
											return {
												type: ContentType.ToolResult,
												content: [
													{
														type: ContentType.Text,
														text: block.content,
													},
												],
												is_error: false,
											};
										}

										if (
											block.type ===
												ContentType.ToolUse &&
											block.jsonParts
										) {
											try {
												const parsed = JSON.parse(
													block.jsonParts.join("")
												);
												return {
													type: ContentType.ToolUse,
													name: "artifacts",
													input: {
														id: parsed.id,
														version_uuid:
															parsed.version_uuid ||
															"",
														content: parsed.content,
														language:
															parsed.language,
														type: parsed.type as InputType,
														command: parsed.command,
													},
												};
											} catch (error) {
												return {
													type: ContentType.Text,
													text: "Invalid tool use content",
													is_error: true,
												};
											}
										}

										return {
											type: ContentType.Text,
											text: block.content,
										};
									}
								);

							await db
								.update(schema.messages)
								.set({
									updated_at: now,
									stop_reason:
										data.stop_reason ||
										StopReason.StopSequence,
								})
								.where(
									eq(
										schema.messages.uuid,
										ws.data.currentMessage.id
									)
								);

							ws.data.currentMessage = null;
						}
						break;

					case "artifact":
						await db
							.insert(schema.artifacts)
							.values({
								id: data.id,
								conversation_uuid: data.conversation_uuid,
								version_uuid: data.version_uuid || null,
								type: data.type || null,
								title: data.title || null,
								content: data.content,
								language: data.language || null,
							})
							.onConflictDoUpdate({
								target: schema.artifacts.id,
								set: {
									version_uuid: data.version_uuid || null,
									type: data.type || null,
									title: data.title || null,
									content: data.content,
									language: data.language || null,
								},
							});
						break;

					default:
						console.warn("Unhandled event type:", type);
				}
			} catch (error) {
				console.error(
					"Message handling error:",
					error instanceof Error ? error.message : String(error),
					type,
					data,
					conversation_uuid,
					endpoint,
					url
				);
				ws.data.currentMessage = null;
			} finally {
				release();
			}
		},
	},
});

console.log("Server running on port 3000");
