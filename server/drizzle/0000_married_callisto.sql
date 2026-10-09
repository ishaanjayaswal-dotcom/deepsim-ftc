CREATE TABLE `paths` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`team_number` integer NOT NULL,
	`category` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`data` text NOT NULL,
	`thumbnail` text NOT NULL,
	`stats` text NOT NULL,
	`upvotes` integer DEFAULT 0 NOT NULL,
	`edit_key_hash` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `paths_category_idx` ON `paths` (`category`);--> statement-breakpoint
CREATE INDEX `paths_upvotes_idx` ON `paths` (`upvotes`);--> statement-breakpoint
CREATE INDEX `paths_created_at_idx` ON `paths` (`created_at`);--> statement-breakpoint
CREATE TABLE `votes` (
	`path_id` text NOT NULL,
	`voter_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`path_id`, `voter_id`),
	FOREIGN KEY (`path_id`) REFERENCES `paths`(`id`) ON UPDATE no action ON DELETE cascade
);
