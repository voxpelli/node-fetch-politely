-- ----------------------------
--  Table structure for polite_hosts
-- ----------------------------
DROP TABLE IF EXISTS "polite_hosts";
CREATE TABLE "polite_hosts" (
	"hostname" varchar(255) NOT NULL COLLATE "default",
	"added" timestamp(6) NOT NULL
)
WITH (OIDS=FALSE);

-- ----------------------------
--  Table structure for polite_queue
-- ----------------------------
DROP TABLE IF EXISTS "polite_queue";
CREATE TABLE "polite_queue" (
	"id" int4 NOT NULL DEFAULT nextval('polite_queue_id_seq'::regclass),
	"url" varchar(255) NOT NULL COLLATE "default",
	"hostname" varchar(255) NOT NULL COLLATE "default",
	"noduplicate" bool,
	"messages" json,
	"added" timestamp(6) NOT NULL,
	"updated" timestamp(6) NOT NULL
)
WITH (OIDS=FALSE);

-- ----------------------------
--  Primary key structure for table polite_hosts
-- ----------------------------
ALTER TABLE "polite_hosts" ADD PRIMARY KEY ("hostname") NOT DEFERRABLE INITIALLY IMMEDIATE;

-- ----------------------------
--  Indexes structure for table polite_hosts
-- ----------------------------
CREATE INDEX  "polite_hosts_added_index" ON "polite_hosts" USING btree(added ASC NULLS LAST);

-- ----------------------------
--  Primary key structure for table polite_queue
-- ----------------------------
ALTER TABLE "polite_queue" ADD PRIMARY KEY ("id") NOT DEFERRABLE INITIALLY IMMEDIATE;

-- ----------------------------
--  Uniques structure for table polite_queue
-- ----------------------------
ALTER TABLE "polite_queue" ADD CONSTRAINT "polite_queue_url_noduplicate_unique" UNIQUE ("url","noduplicate") NOT DEFERRABLE INITIALLY IMMEDIATE;

