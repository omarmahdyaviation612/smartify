/**
 * Read-only production curriculum inventory.
 *
 * Usage after the backend build has compiled this file:
 *   node apps/backend/dist/scripts/production-curriculum-inventory.js [--manifest=docs/unit-page-offset-wave-b.plan.json]
 *
 * Every database read is made through one Prisma interactive transaction
 * after `SET TRANSACTION READ ONLY` has been verified. This script does not
 * load dotenv, generate content, or write database state.
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { prisma as sharedPrisma } from "@smartify/database";
import { CurriculumSourceStorageFactory } from "../interactive-lesson/unit-grounding/storage/curriculum-source-storage.factory";
import type { CurriculumSourceStorage } from "../interactive-lesson/unit-grounding/storage/curriculum-source-storage.interface";
import {
  assignmentIdentityMatches,
  TOPIC_GROUNDING_ASSIGNMENT_VERSION,
  MAPPER_PROMPT_VERSION,
} from "../ai/context/topic-grounding-assignment.util";
import {
  evaluateTopicGroundingGate,
  QUESTION_PROVENANCE_SELECT,
  UNIT_GATE_SELECT,
} from "../ai/context/topic-content-provenance.util";
import { classifyUnitContentReadiness } from "../ai/context/unit-content-readiness.util";

type ReviewedManifest = {
  version?: number;
  generatedFrom?: string;
  books?: Array<{
    subjectId: string;
    label?: string;
    classification?: string;
    sourceFile?: string;
    expectedUnits?: Array<{ unitId: string; order: number; persistedStart: number; persistedEnd: number }>;
  }>;
};

type InventoryOptions = {
  prisma: any;
  emit: (line: string) => void;
  runId?: string;
  now?: Date;
  manifest?: ReviewedManifest | null;
  manifestState?: string;
  manifestRequired?: boolean;
  sourceStorage?: CurriculumSourceStorage | null;
  expectedAssignmentVersion?: number;
  expectedMapperPromptVersion?: number;
  close?: () => Promise<void>;
};

type EntitlementAggregate = {
  subjectId: string;
  grantRows: bigint | number;
  activeRows: bigint | number;
  expiredRows: bigint | number;
  matchingProfileScopeRows: bigint | number;
  activeMatchingProfileScopeRows: bigint | number;
};

const READ_ONLY_SQL = "SET TRANSACTION READ ONLY";
const REPEATABLE_READ_SQL = "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ";
const VERIFY_READ_ONLY_SQL = "SELECT current_setting('transaction_read_only') AS \"transactionReadOnly\"";
const ENTITLEMENT_AGGREGATE_SQL = `
  SELECT ss."subjectId" AS "subjectId",
         COUNT(*) AS "grantRows",
         COUNT(*) FILTER (WHERE ss."expiresAt" IS NULL OR ss."expiresAt" > $1) AS "activeRows",
         COUNT(*) FILTER (WHERE ss."expiresAt" IS NOT NULL AND ss."expiresAt" <= $1) AS "expiredRows",
         COUNT(*) FILTER (WHERE sp."gradeId" = s."gradeId" AND sp."curriculumId" = g."curriculumId") AS "matchingProfileScopeRows",
         COUNT(*) FILTER (WHERE (ss."expiresAt" IS NULL OR ss."expiresAt" > $1)
                           AND sp."gradeId" = s."gradeId" AND sp."curriculumId" = g."curriculumId") AS "activeMatchingProfileScopeRows"
    FROM "StudentSubject" ss
    JOIN "StudentProfile" sp ON sp."id" = ss."studentId"
    JOIN "Subject" s ON s."id" = ss."subjectId"
    JOIN "Grade" g ON g."id" = s."gradeId"
   GROUP BY ss."subjectId"
`;

function count(value: bigint | number | null | undefined): number {
  return Number(value ?? 0);
}

function readOnlyVerified(rows: unknown): boolean {
  if (!Array.isArray(rows) || rows.length !== 1) return false;
  const row = rows[0] as { transactionReadOnly?: unknown } | null;
  return row?.transactionReadOnly === "on";
}

function sourceReference(unit: any, subject: any): string | null {
  return unit.sourceFileOverride ?? subject.sourceFile ?? null;
}

function sourceState(
  hasMappedSource: boolean,
  probe: { state: "PRESENT" | "UNKNOWN" | "INACCESSIBLE" } | undefined,
) {
  if (!hasMappedSource) return { mapped: false, objectState: "MISSING_MAPPING", readability: "UNKNOWN_NOT_TESTED" };
  return { mapped: true, objectState: probe?.state ?? "UNKNOWN", readability: "UNKNOWN_NOT_TESTED" };
}

function manifestIndex(manifest: ReviewedManifest | null | undefined) {
  const bySubject = new Map<string, NonNullable<ReviewedManifest["books"]>[number]>();
  for (const book of manifest?.books ?? []) {
    if (book.classification === "OFFSET_CONSTANT" && Array.isArray(book.expectedUnits)) {
      bySubject.set(book.subjectId, book);
    }
  }
  return bySubject;
}

function manifestSubjectReport(subject: any, book: NonNullable<ReviewedManifest["books"]>[number] | undefined) {
  if (!book) return { applicable: false };
  const unitsById = new Map<string, any>(subject.units.map((unit: any) => [unit.id, unit]));
  let missingUnits = 0;
  let rangeMismatches = 0;
  const observedExpectations = (book.expectedUnits ?? []).flatMap((expected) => {
    const unit = unitsById.get(expected.unitId);
    if (!unit) {
      missingUnits++;
      return [];
    }
    const rangeMatches = unit.sourcePageStart === expected.persistedStart && unit.sourcePageEnd === expected.persistedEnd;
    if (!rangeMatches) rangeMismatches++;
    return [{
      unitId: unit.id,
      expectedOrder: expected.order,
      expectedRange: { start: expected.persistedStart, end: expected.persistedEnd },
      observedRange: { start: unit.sourcePageStart, end: unit.sourcePageEnd },
      rangeMatches,
    }];
  });
  return {
    applicable: true,
    label: book.label ?? null,
    source: "reviewed wave-b page-offset plan",
    classification: book.classification,
    expectedUnitCount: book.expectedUnits?.length ?? 0,
    missingUnitCount: missingUnits,
    rangeMismatchCount: rangeMismatches,
    observedExpectations,
  };
}

function safeAssignmentReason(assignment: any, gateState: string) {
  if (gateState === "MISSING") return "ASSIGNMENT_ROW_MISSING";
  if (gateState === "STALE") return "ASSIGNMENT_IDENTITY_STALE";
  if (gateState === "EMPTY") return "ASSIGNMENT_RESOLVES_EMPTY";
  if (gateState !== "BLOCKED") return null;
  const reason = typeof assignment?.reason === "string" ? assignment.reason : "";
  if (/no compact grounding candidates/i.test(reason)) return "NO_CANDIDATES";
  if (/budget unavailable/i.test(reason)) return "BUDGET_UNAVAILABLE";
  if (/mapper rejected/i.test(reason)) return "MAPPER_RESPONSE_REJECTED";
  if (/supported:false/i.test(reason)) return "MAPPER_UNSUPPORTED";
  if (/no slice-usable reference/i.test(reason)) return "NO_USABLE_SLICE_REFERENCE";
  if (/deterministic steps 1-5 found no assignment/i.test(reason)) return "NO_DETERMINISTIC_ASSIGNMENT";
  return "BLOCKED_REASON_REDACTED";
}

function topicReport(topic: any, readinessTopic: any, unit: any, assignmentVersion: number, mapperPromptVersion: number) {
  const assignment = topic.groundingAssignment ?? null;
  const assignmentIdentityValid = assignment
    ? assignmentIdentityMatches(assignment, unit)
    : false;
  const storedQuestions = topic.questions.filter((question: any) => !question.isPlaceholder);
  const gate = evaluateTopicGroundingGate({ ...topic, unit });
  const legacyLessonRows = topic.lessons.filter((lesson: any) => !lesson.isPlaceholder);
  return {
    id: topic.id,
    order: topic.order,
    nameEn: topic.nameEn,
    nameAr: topic.nameAr,
    assignment: {
      persisted: assignment !== null,
      status: assignment?.status ?? "MISSING",
      method: assignment?.method ?? null,
      confidence: assignment?.confidence ?? null,
      safeReasonCode: safeAssignmentReason(assignment, readinessTopic?.gate ?? "UNKNOWN"),
      identityValid: assignmentIdentityValid,
      unitGroundingVersion: assignment?.unitGroundingVersion ?? null,
      unitSourceFingerprint: assignment?.unitSourceFingerprint ?? null,
      assignmentVersion: assignment?.assignmentVersion ?? null,
      mapperPromptVersion: assignment?.mapperPromptVersion ?? null,
      expectedVersion: !assignment || assignment.method === "REVIEWED"
        ? null
        : assignment.method === "AI_MAPPER" ? mapperPromptVersion : assignmentVersion,
      computedCurrentFingerprint: gate.state === "READY" ? gate.provenance.groundingAssignmentFingerprint : null,
    },
    groundingGate: readinessTopic?.gate ?? "UNKNOWN",
    unavailableReasonCode: safeAssignmentReason(assignment, readinessTopic?.gate ?? "UNKNOWN"),
    lesson: {
      teachingStepsPresent: topic.teachingStepsJson != null,
      provenance: readinessTopic?.steps ?? "UNKNOWN",
      servable: readinessTopic?.stepsServable ?? false,
      generationSource: topic.generationSource ?? null,
      groundingSourceFingerprintUsed: topic.groundingSourceFingerprintUsed ?? null,
      groundingAssignmentFingerprintUsed: topic.groundingAssignmentFingerprintUsed ?? null,
      legacyLessonRecords: legacyLessonRows.length,
      legacyLessonRecordsWithContent: legacyLessonRows.filter((lesson: any) => lesson.contentEn != null || lesson.contentAr != null).length,
      legacyLessonRecordsNeedingReview: legacyLessonRows.filter((lesson: any) => lesson.needsReview).length,
    },
    questions: {
      storedNonPlaceholder: storedQuestions.length,
      provenanceEvaluated: readinessTopic?.gate === "READY",
      current: readinessTopic?.gate === "READY" ? readinessTopic?.stored?.CURRENT ?? 0 : null,
      legacy: readinessTopic?.gate === "READY" ? readinessTopic?.stored?.LEGACY ?? 0 : null,
      mismatched: readinessTopic?.gate === "READY" ? readinessTopic?.stored?.MISMATCH ?? 0 : null,
      runtimeServableCount: readinessTopic?.gate === "READY"
        ? Object.values(readinessTopic?.servable ?? {}).reduce((sum: number, value: any) => sum + Number(value ?? 0), 0)
        : 0,
      retiredCount: storedQuestions.filter((question: any) => question.retiredAt != null).length,
      readyPoolUnderTarget: readinessTopic?.gate === "READY" ? readinessTopic.topUpRequired : null,
    },
    unavailableOrStaleDetail: readinessTopic?.gate !== "READY"
      || !readinessTopic?.stepsServable
      || readinessTopic?.topUpRequired
      || !!readinessTopic?.stored?.MISMATCH,
  };
}

function mapCurricula(
  curricula: any[],
  entitlementRows: EntitlementAggregate[],
  probes: Map<string, { state: "PRESENT" | "UNKNOWN" | "INACCESSIBLE" }>,
  manifest: ReviewedManifest | null | undefined,
  now: Date,
  assignmentVersion: number,
  mapperPromptVersion: number,
) {
  const entitlements = new Map(entitlementRows.map((row) => [row.subjectId, row]));
  const books = manifestIndex(manifest);
  const seenManifestSubjects = new Set<string>();
  const summary = {
    curricula: curricula.length,
    grades: 0,
    subjects: 0,
    activeSubjects: 0,
    inactiveSubjects: 0,
    unpricedSubjects: 0,
    units: 0,
    groundedUnits: 0,
    ungroundedUnits: 0,
    groundingFingerprintFreshnessUnknownUnits: 0,
    topics: 0,
    unavailableTopics: 0,
    staleOrBlockedAssignments: 0,
    missingAssignments: 0,
    blockedAssignments: 0,
    staleAssignments: 0,
    emptyAssignments: 0,
    missingLessons: 0,
    staleLessons: 0,
    legacyLessonRecords: 0,
    missingOrUnderTargetPools: 0,
    questionPoolsUnavailableForProvenance: 0,
    manifestApplicableSubjects: 0,
    manifestMissingSubjects: 0,
    manifestMissingUnits: 0,
    manifestRangeMismatches: 0,
    subjectSourcesMapped: 0,
    subjectSourcesPresent: 0,
    subjectSourcesUnknown: 0,
    subjectSourcesInaccessible: 0,
    sourcePresent: 0,
    sourceUnknown: 0,
    sourceInaccessible: 0,
  };

  const mapped = curricula.map((curriculum) => ({
    id: curriculum.id,
    code: curriculum.code,
    nameEn: curriculum.nameEn,
    nameAr: curriculum.nameAr,
    isActive: curriculum.isActive,
    grades: curriculum.grades.map((grade: any) => {
      summary.grades++;
      return {
        id: grade.id,
        level: grade.level,
        nameEn: grade.nameEn,
        nameAr: grade.nameAr,
        isActive: grade.isActive,
        subjects: grade.subjects.map((subject: any) => {
          summary.subjects++;
          if (subject.isActive) summary.activeSubjects++; else summary.inactiveSubjects++;
          if (subject.priceEGP == null) summary.unpricedSubjects++;
          const scopeActive = curriculum.isActive && grade.isActive && subject.isActive;
          const entitlement = entitlements.get(subject.id);
          const book = books.get(subject.id);
          if (book) seenManifestSubjects.add(subject.id);
          const unitReports = subject.units.map((unit: any) => {
            summary.units++;
            const effectiveSource = sourceReference(unit, subject);
            const sourceGrounded = unit.groundingNotesJson != null
              && unit.groundingVersion != null
              && unit.groundingSourceFingerprint != null;
            if (sourceGrounded) summary.groundedUnits++; else summary.ungroundedUnits++;
            const readiness = classifyUnitContentReadiness({
              ...unit,
              topics: unit.topics.map((topic: any) => ({
                ...topic,
                activity: topic._count.lessonSessions + topic._count.quizResults
                  + topic.questions.reduce((total: number, question: any) => total + question._count.attempts, 0)
                  + topic.lessons.reduce((total: number, lesson: any) => total + lesson._count.progress, 0),
              })),
            });
            const readinessByTopic = new Map(readiness.topics.map((item) => [item.topicId, item]));
            for (const topic of unit.topics) {
              const readyTopic: any = readinessByTopic.get(topic.id);
              summary.topics++;
              if (readyTopic?.gate !== "READY") summary.unavailableTopics++;
              if (!topic.groundingAssignment || readyTopic?.gate === "MISSING") summary.missingAssignments++;
              if (readyTopic?.gate === "BLOCKED") summary.blockedAssignments++;
              if (readyTopic?.gate === "STALE") summary.staleAssignments++;
              if (readyTopic?.gate === "EMPTY") summary.emptyAssignments++;
              if (["MISSING", "BLOCKED", "STALE", "EMPTY"].includes(readyTopic?.gate)) summary.staleOrBlockedAssignments++;
              if (!topic.teachingStepsJson) summary.missingLessons++;
              if (readyTopic?.steps === "MISMATCH") summary.staleLessons++;
              summary.legacyLessonRecords += topic.lessons.filter((lesson: any) => !lesson.isPlaceholder).length;
              if (readyTopic?.topUpRequired) summary.missingOrUnderTargetPools++;
              if (readyTopic?.gate !== "READY") summary.questionPoolsUnavailableForProvenance++;
            }
            const source = sourceState(!!effectiveSource, probes.get(unit.id));
            if (source.objectState === "PRESENT") summary.sourcePresent++;
            else if (source.objectState === "INACCESSIBLE") summary.sourceInaccessible++;
            else if (source.objectState === "UNKNOWN") summary.sourceUnknown++;
            const groundingState = !sourceGrounded
              ? "UNGROUNDED"
              : "FINGERPRINT_PRESENT_FRESHNESS_UNKNOWN_SOURCE_BYTES_NOT_READ";
            if (sourceGrounded) summary.groundingFingerprintFreshnessUnknownUnits++;
            return {
              id: unit.id,
              order: unit.order,
              nameEn: unit.nameEn,
              nameAr: unit.nameAr,
              observedState: "PRESENT_IN_DATABASE",
              source: {
                ...source,
                usesUnitOverride: unit.sourceFileOverride != null,
                pageRange: { start: unit.sourcePageStart, end: unit.sourcePageEnd },
              },
              grounding: {
                state: groundingState,
                notesPresent: unit.groundingNotesJson != null,
                version: unit.groundingVersion,
                sourceFingerprint: unit.groundingSourceFingerprint,
                fingerprintFreshness: sourceGrounded ? "UNKNOWN_SOURCE_BYTES_NOT_READ" : "NOT_APPLICABLE_UNGROUNDED",
                extractionPromptVersion: unit.groundingPromptVersion,
                model: unit.groundingModel,
                generatedAt: unit.groundingGeneratedAt,
                provenanceMode: readiness.mode,
              },
              computedReadiness: readiness,
              topics: unit.topics.map((topic: any) => topicReport(
                topic,
                readinessByTopic.get(topic.id),
                unit,
                assignmentVersion,
                mapperPromptVersion,
              )),
            };
          });
          const manifestReport = manifestSubjectReport(subject, book);
          if (manifestReport.applicable) {
            summary.manifestApplicableSubjects++;
            summary.manifestMissingUnits += manifestReport.missingUnitCount ?? 0;
            summary.manifestRangeMismatches += manifestReport.rangeMismatchCount ?? 0;
          }
          const sourceStateForSubject = subject.sourceFile == null ? "MISSING_MAPPING" : "MAPPED";
          const subjectSourceProbe = probes.get(`subject:${subject.id}`)?.state ?? (subject.sourceFile == null ? "MISSING_MAPPING" : "UNKNOWN");
          if (subject.sourceFile != null) summary.subjectSourcesMapped++;
          if (subjectSourceProbe === "PRESENT") summary.subjectSourcesPresent++;
          else if (subjectSourceProbe === "INACCESSIBLE") summary.subjectSourcesInaccessible++;
          else if (subject.sourceFile != null) summary.subjectSourcesUnknown++;
          return {
            id: subject.id,
            nameEn: subject.nameEn,
            nameAr: subject.nameAr,
            publication: { isActive: subject.isActive, owningGradeActive: grade.isActive, owningCurriculumActive: curriculum.isActive, activeHierarchy: scopeActive },
            pricing: { state: subject.priceEGP == null ? "NOT_SET" : "SET", priceEGP: subject.priceEGP == null ? null : subject.priceEGP.toString() },
            sourceMapping: { state: sourceStateForSubject, objectState: subjectSourceProbe, usesUnitOverrides: subject.units.some((unit: any) => unit.sourceFileOverride != null), readability: "UNKNOWN_NOT_TESTED" },
            discoveryAndEntitlement: {
              currentCheckoutSubjectPredicate: subject.isActive,
              currentDashboardSelectionRowCountInOwningScope: count(entitlement?.matchingProfileScopeRows),
              assignedRows: count(entitlement?.grantRows),
              activeEntitlementRows: count(entitlement?.activeRows),
              expiredEntitlementRows: count(entitlement?.expiredRows),
              activeEntitlementRowsInOwningScope: count(entitlement?.activeMatchingProfileScopeRows),
              asOf: now.toISOString(),
              note: "Counts only; current dashboard lists assigned StudentSubject rows. Runtime entitlement checks reject expired grants.",
            },
            manifestExpectation: manifestReport,
            units: unitReports,
          };
        }),
      };
    }),
  }));

  for (const book of books.values()) {
    if (!seenManifestSubjects.has(book.subjectId)) summary.manifestMissingSubjects++;
  }
  return { summary, curricula: mapped };
}

async function probeSources(
  subjects: any[],
  storage: CurriculumSourceStorage | null,
): Promise<Map<string, { state: "PRESENT" | "UNKNOWN" | "INACCESSIBLE" }>> {
  const probes = new Map<string, { state: "PRESENT" | "UNKNOWN" | "INACCESSIBLE" }>();
  const jobs: Array<() => Promise<void>> = [];
  for (const curriculum of subjects) {
    for (const grade of curriculum.grades) {
        for (const subject of grade.subjects) {
          if (subject.sourceFile) {
            if (!storage) {
              probes.set(`subject:${subject.id}`, { state: "UNKNOWN" });
            } else {
              jobs.push(async () => {
                try {
                  const present = await storage.exists(subject.sourceFile, { curriculumCode: curriculum.code, gradeLevel: grade.level });
                  probes.set(`subject:${subject.id}`, { state: present ? "PRESENT" : "UNKNOWN" });
                } catch {
                  probes.set(`subject:${subject.id}`, { state: "INACCESSIBLE" });
                }
              });
            }
          }
          for (const unit of subject.units) {
          const source = sourceReference(unit, subject);
          if (!source) continue;
          if (!storage) {
            probes.set(unit.id, { state: "UNKNOWN" });
            continue;
          }
          jobs.push(async () => {
            try {
              const present = await storage.exists(source, { curriculumCode: curriculum.code, gradeLevel: grade.level });
              // The existing S3 exists() catches all errors and returns false;
              // false therefore cannot be reported as confirmed absence.
              probes.set(unit.id, { state: present ? "PRESENT" : "UNKNOWN" });
            } catch {
              probes.set(unit.id, { state: "INACCESSIBLE" });
            }
          });
        }
      }
    }
  }
  for (let offset = 0; offset < jobs.length; offset += 8) {
    await Promise.all(jobs.slice(offset, offset + 8).map((job) => job()));
  }
  return probes;
}

export async function collectProductionCurriculumInventory(options: InventoryOptions): Promise<{ exitCode: number; report?: unknown }> {
  const runId = options.runId ?? crypto.randomUUID();
  const now = options.now ?? new Date();
  const emit = options.emit;
  emit(`INVENTORY_START ${runId}`);
  try {
    if (options.manifestRequired && !options.manifest) {
      throw new Error(options.manifestState === "INVALID_MANIFEST" ? "INVALID_MANIFEST" : "MANIFEST_NOT_AVAILABLE");
    }
    const snapshot = await options.prisma.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe(READ_ONLY_SQL);
      await tx.$executeRawUnsafe(REPEATABLE_READ_SQL);
      const readOnlyRows = await tx.$queryRawUnsafe(VERIFY_READ_ONLY_SQL);
      if (!readOnlyVerified(readOnlyRows)) throw new Error("READ_ONLY_VERIFICATION_FAILED");

      const curricula = await tx.curriculum.findMany({
        orderBy: { code: "asc" },
        select: {
          id: true, code: true, nameEn: true, nameAr: true, isActive: true,
          grades: {
            orderBy: { level: "asc" },
            select: {
              id: true, nameEn: true, nameAr: true, level: true, isActive: true,
              subjects: {
                orderBy: { nameEn: "asc" },
                select: {
                  id: true, nameEn: true, nameAr: true, isActive: true, sourceFile: true, priceEGP: true,
                  units: {
                    orderBy: { order: "asc" },
                    select: {
                      nameEn: true, nameAr: true, order: true,
                      sourcePageStart: true, sourcePageEnd: true, sourceFileOverride: true,
                      groundingGeneratedAt: true, groundingModel: true, groundingPromptVersion: true,
                      ...UNIT_GATE_SELECT,
                      topics: {
                        orderBy: { order: "asc" },
                        select: {
                          id: true, nameEn: true, nameAr: true, order: true, teachingStepsJson: true,
                          generationSource: true,
                          groundingSourceFingerprintUsed: true, groundingAssignmentFingerprintUsed: true,
                          groundingAssignment: {
                            select: {
                              unitGroundingVersion: true, unitSourceFingerprint: true, assignmentVersion: true,
                              method: true, mapperPromptVersion: true, status: true, confidence: true, reason: true,
                              matchedConceptNames: true, matchedHintTitles: true,
                            },
                          },
                          topicSourceEvidence: {
                            select: { status: true, unitId: true, sourceFingerprint: true, evidenceJson: true },
                          },
                          questions: {
                            select: {
                              topicId: true, isPlaceholder: true, ...QUESTION_PROVENANCE_SELECT,
                              _count: { select: { attempts: true } },
                            },
                          },
                          lessons: { select: { contentEn: true, contentAr: true, isPlaceholder: true, needsReview: true, _count: { select: { progress: true } } } },
                          _count: { select: { lessonSessions: true, quizResults: true } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
      const entitlementRows = await tx.$queryRawUnsafe(ENTITLEMENT_AGGREGATE_SQL, now);
      if (!Array.isArray(curricula) || !Array.isArray(entitlementRows)) throw new Error("INCOMPLETE_DATABASE_RESULT");
      return { curricula, entitlementRows };
    }, { maxWait: 10_000, timeout: 120_000 });

    const probes = await probeSources(snapshot.curricula, options.sourceStorage ?? null);
    const manifestReport = mapCurricula(
      snapshot.curricula,
      snapshot.entitlementRows,
      probes,
      options.manifest ?? null,
      now,
      options.expectedAssignmentVersion ?? TOPIC_GROUNDING_ASSIGNMENT_VERSION,
      options.expectedMapperPromptVersion ?? MAPPER_PROMPT_VERSION,
    );
    const expectedManifestCount = manifestIndex(options.manifest).size;
    const report = {
      schemaVersion: 1,
      runId,
      observedAt: now.toISOString(),
      completeness: "COMPLETE_DATABASE_SNAPSHOT",
      manifest: {
        state: options.manifestState ?? (options.manifest ? "LOADED" : "NOT_AVAILABLE"),
        generatedFrom: options.manifest?.generatedFrom ?? null,
        applicableReviewedBooks: expectedManifestCount,
        limitations: "Only listed reviewed books establish Unit expectations; absence from other books/manifests is not treated as missing.",
      },
      summaries: manifestReport.summary,
      curricula: manifestReport.curricula,
      stateDefinitions: {
        sourceObject: "PRESENT is confirmed by exists(); UNKNOWN includes false from the S3 helper because it conflates not-found and access errors; INACCESSIBLE means the call threw.",
        sourceReadability: "UNKNOWN_NOT_TESTED; PDFs are not fetched or parsed.",
        lessonAndQuestionReadiness: "Computed by classifyUnitContentReadiness and the runtime provenance gates.",
        missingExpectedRecords: "Counts only, derived from an applicable reviewed manifest; absent IDs are not printed.",
      },
    };
    await options.close?.();
    emit(`INVENTORY_REPORT ${JSON.stringify(report)}`);
    emit(`INVENTORY_SUCCESS ${runId}`);
    return { exitCode: 0, report };
  } catch (error) {
    try { await options.close?.(); } catch { /* sanitized failure remains authoritative */ }
    const category = error instanceof Error && error.message === "READ_ONLY_VERIFICATION_FAILED"
      ? "READ_ONLY_VERIFICATION_FAILED"
      : error instanceof Error && error.message === "INCOMPLETE_DATABASE_RESULT"
        ? "INCOMPLETE_DATABASE_RESULT"
        : error instanceof Error && error.message === "MANIFEST_NOT_AVAILABLE"
          ? "MANIFEST_NOT_AVAILABLE"
          : error instanceof Error && error.message === "INVALID_MANIFEST"
            ? "INVALID_MANIFEST"
        : "INVENTORY_FAILED";
    emit(`INVENTORY_FAILURE ${runId} ${category}`);
    return { exitCode: 1 };
  }
}

function parseManifestArg(argv: string[]): string | null {
  const args = argv.filter((arg) => arg.startsWith("--manifest="));
  if (args.length > 1 || argv.some((arg) => !arg.startsWith("--manifest="))) throw new Error("INVALID_ARGUMENTS");
  return args[0]?.slice("--manifest=".length) ?? null;
}

function loadManifest(filename: string | null) {
  const file = filename ?? path.resolve(process.cwd(), "docs/unit-page-offset-wave-b.plan.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as ReviewedManifest;
    if (parsed.version !== 1 || !Array.isArray(parsed.books)) return { manifest: null, state: "INVALID_MANIFEST" };
    return { manifest: parsed, state: "LOADED" };
  } catch {
    return { manifest: null, state: "NOT_AVAILABLE" };
  }
}

async function main() {
  let manifestArg: string | null;
  try {
    manifestArg = parseManifestArg(process.argv.slice(2));
  } catch {
    const runId = crypto.randomUUID();
    console.log(`INVENTORY_START ${runId}`);
    console.log(`INVENTORY_FAILURE ${runId} INVALID_ARGUMENTS`);
    process.exitCode = 1;
    return;
  }
  const loaded = loadManifest(manifestArg);
  let sourceStorage: CurriculumSourceStorage | null = null;
  try {
    sourceStorage = new CurriculumSourceStorageFactory().get();
  } catch {
    // Missing/invalid storage configuration is reportable as UNKNOWN, not fatal.
  }
  const result = await collectProductionCurriculumInventory({
    prisma: sharedPrisma,
    emit: (line) => console.log(line),
    manifest: loaded.manifest,
    manifestState: loaded.state,
    manifestRequired: manifestArg !== null,
    sourceStorage,
    close: () => sharedPrisma.$disconnect(),
  });
  process.exitCode = result.exitCode;
}

if (require.main === module) {
  void main().catch(() => {
    // Last-resort sanitized failure path for errors outside the inventory
    // transaction (for example client initialization); no raw error is logged.
    const runId = crypto.randomUUID();
    console.log(`INVENTORY_START ${runId}`);
    console.log(`INVENTORY_FAILURE ${runId} INVENTORY_FAILED`);
    process.exitCode = 1;
  });
}
