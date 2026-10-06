# Shared MOE Arabic and Social Studies Across Curricula

## Goal

Let students in British and American curricula discover and study the existing Egyptian MOE Arabic and Social Studies content for the corresponding grade. Keep each textbook, Unit, Topic, grounding assignment, lesson, and question pool in the MOE source subject. Do not upload duplicate PDFs or invoke AI to ground shared content again.

## Design

Add an explicit, optional subject-to-subject sharing relation from a target-curriculum Subject to one canonical MOE Subject. Configure it per target grade and subject. A target subject remains a catalog and entitlement item for its curriculum; the linked MOE subject remains the sole content owner. Match grades by the existing numeric `Grade.level`, and require an explicit configured link rather than inferring links from subject names at runtime.

Student discovery returns the target subject with the target curriculum's display and pricing identity. For lesson, practice, quiz, and tutor operations, resolve a shared target subject to its canonical MOE content subject after verifying the student's grade/curriculum scope and access to the requested target subject. Content retrieval uses canonical MOE Units and Topics. Preserve the canonical content IDs in progress and attempts so the shared content has one history and one source of truth. Where responses include subject identity, expose the target subject identity for catalog grouping while retaining canonical topic/content IDs.

The admin workflow must allow creating a target-curriculum catalog Subject directly from an eligible MOE source when that target Subject does not yet exist, as well as configuring or removing an existing share link. Creating a target Subject copies only the display names and canonical source ID; it creates no textbook file, Units, Topics, or grounding and invokes no AI. The configuration must reject self-links, cycles, inactive or cross-grade targets, and targets that are not in the designated MOE curriculum. Only Arabic and Social Studies are eligible for this launch path.

## Data and rollout

Use an additive nullable self-relation on `Subject` for the canonical shared-content subject. No existing rows are changed automatically. An administrator explicitly selects the target grade and MOE source subject; the application matches by grade level and subject category before creating or linking the target catalog Subject. Keep the target Subject's own `sourceFile` unset for shared content so no duplicate source is implied. Its price remains null until an admin separately sets pricing.

This requires a database migration and a backend deployment. The current Railway backend is blocked before application startup by Prisma P3009 on the historical migration `20260925141543_add_student_school_info`; the share feature cannot be considered live until that migration issue is safely resolved and the schema migration deploys. Do not run Production queries, resolve migration history, or deploy as part of implementation without separate explicit authorization and verified migration state.

## Failure behavior and access

A missing, inactive, invalid, or wrong-grade share link fails closed: the target subject is omitted or unavailable and no canonical content is returned. Existing content readiness and grounding/provenance checks remain authoritative on the canonical MOE content. Subject entitlement remains checked against the student's selected target subject; test-student behavior follows existing rules. Billing continues to price the target subject independently and never treats a missing price as free.

## Verification

Add mocked tests covering grade-scoped discovery, correct source resolution for all student content entry points, target-subject entitlement enforcement, one canonical content/progress identity, invalid links, and no provider or grounding calls during link resolution. Run the backend schema/client generation, focused mocked tests, and backend build. Do not connect to Production or run Production queries.

## Out of scope

This change does not copy MOE records, upload British/American Arabic or Social Studies PDFs, regenerate grounding/lessons/questions, alter curriculum content, or automatically share other subjects. Any initial grade-to-subject links require verified catalog IDs and administrator confirmation; no Production catalog inventory is assumed here.
