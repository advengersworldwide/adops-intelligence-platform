CREATE TABLE IF NOT EXISTS "dashboard_layouts" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "active_widgets" jsonb NOT NULL,
  "layout" jsonb NOT NULL,
  "preset" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "dashboard_layouts_user_id_unique" UNIQUE("user_id")
);
ALTER TABLE "dashboard_layouts"
  ADD CONSTRAINT "dashboard_layouts_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
