CREATE TYPE "TopicGroundingAssignmentMethod" AS ENUM ('HINT_MATCH', 'KEYWORD_OVERLAP', 'SINGLE_TOPIC_FALLBACK', 'REVIEW_FULL_UNIT', 'PAGE_ORDER_GAP', 'AI_MAPPER');
CREATE TYPE "TopicGroundingAssignmentConfidence" AS ENUM ('HIGH', 'LOW');
CREATE TYPE "TopicGroundingAssignmentStatus" AS ENUM ('READY', 'BLOCKED');

CREATE TABLE "TopicGroundingAssignment" (
  "id" TEXT NOT NULL,
  "topicId" TEXT NOT NULL,
  "unitGroundingVersion" INTEGER NOT NULL,
  "unitSourceFingerprint" TEXT NOT NULL,
  "assignmentVersion" INTEGER NOT NULL,
  "method" "TopicGroundingAssignmentMethod" NOT NULL,
  "confidence" "TopicGroundingAssignmentConfidence" NOT NULL,
  "status" "TopicGroundingAssignmentStatus" NOT NULL,
  "matchedConceptNames" JSONB NOT NULL,
  "matchedHintTitles" JSONB,
  "mapperModel" TEXT,
  "mapperPromptVersion" INTEGER,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TopicGroundingAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TopicGroundingAssignment_topicId_key" ON "TopicGroundingAssignment"("topicId");
CREATE INDEX "TopicGroundingAssignment_unitGroundingVersion_unitSourceFingerprint_assignmentVersion_idx" ON "TopicGroundingAssignment"("unitGroundingVersion", "unitSourceFingerprint", "assignmentVersion");
ALTER TABLE "TopicGroundingAssignment" ADD CONSTRAINT "TopicGroundingAssignment_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
