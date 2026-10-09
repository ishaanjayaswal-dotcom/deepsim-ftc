import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const paths = sqliteTable(
  "paths",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    teamNumber: integer("team_number").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull().default(""),
    data: text("data").notNull(),
    thumbnail: text("thumbnail").notNull(),
    stats: text("stats").notNull(),
    upvotes: integer("upvotes").notNull().default(0),
    editKeyHash: text("edit_key_hash"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("paths_category_idx").on(table.category),
    index("paths_upvotes_idx").on(table.upvotes),
    index("paths_created_at_idx").on(table.createdAt),
  ],
);

export const votes = sqliteTable(
  "votes",
  {
    pathId: text("path_id")
      .notNull()
      .references(() => paths.id, { onDelete: "cascade" }),
    voterId: text("voter_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.pathId, table.voterId] })],
);
