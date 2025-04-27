// drizzle.config.ts
import type { Config } from "drizzle-kit";

export default {
	schema: "./schema.ts",
	out: "./drizzle",
	dialect: "sqlite",
	dbCredentials: {
		url: "file:claude.db",
	}
} satisfies Config;
