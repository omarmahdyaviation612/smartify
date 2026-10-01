import type { Prisma } from "@smartify/database";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { GroundingSourceExtractionService } from "../../interactive-lesson/unit-grounding/grounding-source-extraction.service";
import { GroundingVisionExecutionService } from "../../interactive-lesson/unit-grounding/grounding-vision-execution.service";

export type SourceEvidenceIdentity = { topicId:string; unitId:string; sourceFingerprint:string; sourcePageStart:number; sourcePageEnd:number; promptVersion:string; extractorModel:string };
function toTopicSourceEvidenceUniqueSelector(identity: SourceEvidenceIdentity): Prisma.TopicSourceEvidenceTopicIdSourceFingerprintSourcePageStartSourcePageEndPromptVersionExtractorModelCompoundUniqueInput {
  return {
    topicId: identity.topicId,
    sourceFingerprint: identity.sourceFingerprint,
    sourcePageStart: identity.sourcePageStart,
    sourcePageEnd: identity.sourcePageEnd,
    promptVersion: identity.promptVersion,
    extractorModel: identity.extractorModel,
  };
}
export function remapTopicEvidence(items: Array<{type:string; label:string; sourceImageIndexes?:number[]}>, start:number, end:number) {
  const count=end-start+1;
  return items.map(item=>{ if(!Array.isArray(item.sourceImageIndexes)||!item.sourceImageIndexes.length) throw new Error("MISSING_SOURCE_PROVENANCE"); const pages=item.sourceImageIndexes.map(i=>{if(!Number.isInteger(i)||i<1||i>count) throw new Error("INVALID_SOURCE_IMAGE_INDEX"); return start+i-1;}); return {...item,sourcePages:[...new Set(pages)]}; });
}

@Injectable()
export class TopicSourceEvidenceService {
  constructor(private readonly prisma: PrismaService, private readonly sourceExtraction: GroundingSourceExtractionService, private readonly vision: GroundingVisionExecutionService) {}
  async getReusable(identity: SourceEvidenceIdentity) {
    return this.prisma.client.topicSourceEvidence.findUnique({ where: { topicId_sourceFingerprint_sourcePageStart_sourcePageEnd_promptVersion_extractorModel: toTopicSourceEvidenceUniqueSelector(identity) } });
  }
  async prepare(identity: SourceEvidenceIdentity) {
    const existing = await this.getReusable(identity);
    if (existing?.status === "READY" || existing?.status === "NOT_FOUND") return existing;
    return this.prisma.client.topicSourceEvidence.upsert({ where: { topicId_sourceFingerprint_sourcePageStart_sourcePageEnd_promptVersion_extractorModel: toTopicSourceEvidenceUniqueSelector(identity) }, create: { ...identity, status: "PREPARING" }, update: { status: "PREPARING", failureCode: null, failureReason: null } });
  }
  isUsable(row: { status: string } | null | undefined): boolean { return row?.status === "READY"; }
  async complete(id:string, status:"READY"|"NOT_FOUND"|"FAILED", evidenceJson?:unknown, failureCode?:string, failureReason?:string) {
    return this.prisma.client.topicSourceEvidence.update({ where:{id}, data:{status,evidenceJson:evidenceJson as any, failureCode, failureReason} });
  }
  async prepareExtraction(identity: SourceEvidenceIdentity, extract: ()=>Promise<{supported:boolean; items?:Array<{type:string;label:string;sourceImageIndexes?:number[]}>}>) {
    if (identity.sourcePageStart < 1 || identity.sourcePageEnd < identity.sourcePageStart) throw new Error("INVALID_SOURCE_WINDOW");
    const existing=await this.getReusable(identity); if(existing?.status === "READY" || existing?.status === "NOT_FOUND") return existing;
    const row=existing ?? await this.prepare(identity);
    try { const result=await extract(); if(!result.supported) return this.complete(row.id,"NOT_FOUND"); const evidence=remapTopicEvidence(result.items??[],identity.sourcePageStart,identity.sourcePageEnd); return this.complete(row.id,"READY",evidence); }
    catch(e) { return this.complete(row.id,"FAILED",undefined,"EXTRACTION_FAILED",e instanceof Error?e.message:"extraction failed"); }
  }

  /** Preparation-only, topic-scoped source extraction. The caller supplies the
   * already-resolved canonical source and curriculum metadata; this service
   * never mutates Unit grounding or assignment state. */
  async prepareTopicEvidence(identity: SourceEvidenceIdentity, input: { sourceKey:string; curriculumCode:string; gradeLevel:number; topicName:string; unitName?:string; subjectName?:string }) {
    if (identity.sourcePageStart < 1 || identity.sourcePageEnd < identity.sourcePageStart) throw new Error("INVALID_SOURCE_WINDOW");
    const existing = await this.getReusable(identity);
    if (existing?.status === "READY" || existing?.status === "NOT_FOUND") return existing;
    const row = existing ?? await this.prepare(identity);
    let accounting: any;
    try {
      const rendered = await this.sourceExtraction.renderSourcePages(input.sourceKey, input.curriculumCode, input.gradeLevel, identity.sourcePageStart, identity.sourcePageEnd);
      const images = (rendered as any).imageDataUrls ?? [];
      if (images.length !== identity.sourcePageEnd - identity.sourcePageStart + 1) throw new Error("RENDERER_PAGE_COUNT_MISMATCH");
      const systemPrompt = `Extract only verified evidence for Topic "${input.topicName}". Return JSON exactly as {"supported":false} or {"supported":true,"items":[{"type":"concept|fact|objective|vocabulary|hint","label":"...","sourceImageIndexes":[1]}]}. Do not add source pages or facts.`;
      const messages = [{ role: "user", content: [{ type: "text", text: `Topic: ${input.topicName}\nUnit: ${input.unitName ?? ""}\nSubject: ${input.subjectName ?? ""}` }, ...images.map((image: any) => ({ type: "text", text: `Image ${image.index}:` })), ...images.map((image: any) => ({ type: "image_url", image_url: { url: image.dataUrl, detail: "high" } }))] }];
      accounting = await this.vision.createAccountingContext({ inputText: systemPrompt, estimatedInputTokens: 1200, maxOutputTokens: 600 });
      const response = await this.vision.execute({ systemPrompt, messages, feature: "TOPIC_SOURCE_EVIDENCE", maxOutputTokens: 600, accountingContext: accounting });
      const parsed = parseTopicEvidenceResponse(response.result?.content ?? response.result);
      if (!parsed.supported) { await this.vision.finalizeSuccess(accounting); return this.complete(row.id, "NOT_FOUND"); }
      const evidence = remapTopicEvidence(parsed.items, identity.sourcePageStart, identity.sourcePageEnd);
      await this.vision.finalizeSuccess(accounting);
      return this.complete(row.id, "READY", evidence);
    } catch (error) {
      if (accounting) await this.vision.finalizeFailure(accounting);
      return this.complete(row.id, "FAILED", undefined, "EXTRACTION_FAILED", error instanceof Error ? error.message : "extraction failed");
    }
  }
}

const allowedTypes = new Set(["concept", "fact", "objective", "vocabulary", "hint"]);
function parseTopicEvidenceResponse(value: unknown): { supported:false } | { supported:true; items:Array<{type:string;label:string;sourceImageIndexes:number[]}> } {
  const parsed = typeof value === "string" ? JSON.parse(value) : value as any;
  if (!parsed || typeof parsed !== "object" || typeof parsed.supported !== "boolean") throw new Error("MALFORMED_PROVIDER_RESPONSE");
  if (parsed.supported === false) { if (Object.keys(parsed).some(k => k !== "supported")) throw new Error("MALFORMED_PROVIDER_RESPONSE"); return { supported:false }; }
  if (!Array.isArray(parsed.items)) throw new Error("MALFORMED_PROVIDER_RESPONSE");
  const items = parsed.items.map((item:any) => { if (!item || !allowedTypes.has(item.type) || typeof item.label !== "string" || !item.label.trim() || !Array.isArray(item.sourceImageIndexes) || !item.sourceImageIndexes.length || item.sourceImageIndexes.some((i:any)=>!Number.isInteger(i))) throw new Error("MALFORMED_PROVIDER_RESPONSE"); return { type:item.type, label:item.label, sourceImageIndexes:item.sourceImageIndexes }; });
  return { supported:true, items };
}
