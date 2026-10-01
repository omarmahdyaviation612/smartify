import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";
import { AIProviderFactory } from "../ai/ai-provider.factory";
import { AIUsageService } from "../ai/usage/ai-usage.service";
import { TopicGroundingAssignmentService, computeDeterministicAssignment } from "../ai/context/topic-grounding-assignment.service";
import { prefilterCompactCandidates } from "../ai/context/compact-grounding-mapper.util";
import { TopicGroundingMapperService } from "../ai/context/topic-grounding-mapper.service";
import { TopicSourceEvidenceService } from "../ai/context/topic-source-evidence.service";
import { resolveEffectiveSourceFile } from "../interactive-lesson/unit-grounding/unit-effective-source.util";
import { DETERMINISTIC_ASSIGNMENT_VERSION, MAPPER_PROMPT_VERSION, resolveAssignedGroundingSlice } from "../ai/context/topic-grounding-assignment.util";

export type RemediationPath="REUSE_READY"|"DETERMINISTIC"|"COMPACT_MAPPER"|"SOURCE_EXTRACTION"|"SOURCE_EXTRACTION_ONLY"|"NO_ACTION"|"BLOCKED_NO_AUTHORIZED_SOURCE_WINDOW";
export type SourceWindow={start:number;end:number};
export type RemediationOptions={topicIds:string[];sourceWindows:Map<string,SourceWindow>;apply:boolean;sourceExtractionOnly?:boolean};

export function parseTopicAllowlist(argv:string[]=process.argv,strict=false){
  if(argv.some(x=>x==="--all-blocked"||x.startsWith("--all-blocked=")))throw new Error("--all-blocked is not supported");
  if(strict&&argv.some(x=>x==="--topicIds"||x.startsWith("--topicIds")&&!x.startsWith("--topicIds=")))throw new Error("invalid --topicIds argument");
  const args=argv.filter(x=>x.startsWith("--topicIds="));if(!args.length)throw new Error("--topicIds is required");if(strict&&args.length!==1)throw new Error("extraction-only mode requires exactly one --topicIds argument");
  const raw=args[0].slice(11);if(!raw)throw new Error("topic allowlist is empty");const parts=raw.split(",");if(strict&&parts.some(x=>!x||x!==x.trim()))throw new Error("extraction-only Topic IDs cannot contain empty or whitespace-normalized entries");
  const ids=parts.map(x=>x.trim()).filter(Boolean);if(!ids.length)throw new Error("topic allowlist is empty");if(strict&&new Set(ids).size!==ids.length)throw new Error("duplicate Topic IDs are not allowed in extraction-only mode");return strict?ids:[...new Set(ids)];
}
export function parseSourceWindows(argv:string[],allowlist:string[],strict=false){
  if(strict&&argv.some(x=>x==="--sourceWindows"||x.startsWith("--sourceWindows")&&!x.startsWith("--sourceWindows=")))throw new Error("invalid --sourceWindows argument");
  const result=new Map<string,SourceWindow>();const args=argv.filter(x=>x.startsWith("--sourceWindows="));if(strict&&args.length!==1)throw new Error("extraction-only mode requires exactly one --sourceWindows argument");const arg=args[0];if(!arg||!arg.slice(16).trim())return result;
  for(const entry of arg.slice(16).split(",")){if(strict&&entry!==entry.trim())throw new Error(`invalid source window: ${entry}`);const match=/^([^:,\s]+):(\d+)-(\d+)$/.exec(entry.trim());if(!match)throw new Error(`invalid source window: ${entry}`);const[,topicId,startText,endText]=match;const start=Number(startText),end=Number(endText);if(!allowlist.includes(topicId))throw new Error(`source window Topic is not allowlisted: ${topicId}`);if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<1||end<start)throw new Error(`invalid source range for ${topicId}`);if(result.has(topicId))throw new Error(`duplicate source window for ${topicId}`);result.set(topicId,{start,end});}return result;
}
export function parseRemediationArgs(argv:string[]=process.argv):RemediationOptions{const flags=argv.filter(x=>x==="--sourceExtractionOnly"||x.startsWith("--sourceExtractionOnly="));if(flags.some(x=>x!=="--sourceExtractionOnly")||flags.length>1)throw new Error("invalid --sourceExtractionOnly flag");const sourceExtractionOnly=flags.length===1;const topicIds=parseTopicAllowlist(argv,sourceExtractionOnly);const sourceWindows=parseSourceWindows(argv,topicIds,sourceExtractionOnly);if(sourceExtractionOnly&&sourceWindows.size!==topicIds.length)throw new Error("extraction-only mode requires one explicit source window per Topic");return{topicIds,sourceWindows,apply:argv.includes("--apply"),sourceExtractionOnly};}

type Dependencies={prisma:any;assignment:{assignGroundingForTopic(id:string):Promise<any>;upsert(input:any):Promise<void>};mapper:{mapTopic(id:string):Promise<any>};sourceEvidence:{getReusable(identity:any):Promise<any>;prepareTopicEvidence(identity:any,input:any):Promise<any>};activeModel():Promise<string>};
export type RemediationTopicReport={topicId:string;topicName:string;unitId:string;unitName:string;path:RemediationPath;before:string;after:string;sourceWindow?:SourceWindow;wouldPerformSideEffects:boolean;factualIdentity?:{groundingVersion:number|null;sourceFingerprint:string|null};reusableReady?:boolean;unitGroundingAvailable?:boolean;readySourceEvidence?:boolean;notFoundSourceEvidence?:boolean;candidateCount?:number;candidateTypes?:string[];deterministicMethod?:string|null;downstreamSliceVerified?:boolean;sourcePages?:number[]};
export type RemediationSummary={mode:"DRY_RUN"|"APPLY";sourceExtractionOnly?:boolean;requestedTopics:number;processedTopics:number;readyBefore:number;readyAfter:number;reusedReady:number;deterministicRecovered:number;compactMapperAttempted:number;compactMapperRecovered:number;sourceExtractionAttempted:number;sourceEvidenceReady:number;sourceEvidenceNotFound:number;sourceEvidenceFailed:number;finalBlocked:number;topics:RemediationTopicReport[]};
function reusable(topic:any){const a=topic.groundingAssignment,u=topic.unit;return!!a&&a.status==="READY"&&a.unitGroundingVersion===u.groundingVersion&&a.unitSourceFingerprint===u.groundingSourceFingerprint;}
function emptySummary(apply:boolean,sourceExtractionOnly=false):RemediationSummary{return{mode:apply?"APPLY":"DRY_RUN",...(sourceExtractionOnly?{sourceExtractionOnly:true}:{}),requestedTopics:0,processedTopics:0,readyBefore:0,readyAfter:0,reusedReady:0,deterministicRecovered:0,compactMapperAttempted:0,compactMapperRecovered:0,sourceExtractionAttempted:0,sourceEvidenceReady:0,sourceEvidenceNotFound:0,sourceEvidenceFailed:0,finalBlocked:0,topics:[]};}

function validateExtractionOnlyBatch(options:RemediationOptions,byId:Map<string,any>):Map<string,string>{
  if(!options.topicIds.length||new Set(options.topicIds).size!==options.topicIds.length)throw new Error("extraction-only mode requires a non-empty unique --topicIds allowlist");
  if(options.sourceWindows.size!==options.topicIds.length||options.topicIds.some(id=>!options.sourceWindows.has(id)))throw new Error("extraction-only mode requires one explicit source window per Topic");
  const sources=new Map<string,string>();
  for(const id of options.topicIds){
    const topic=byId.get(id);if(!topic)throw new Error(`Unknown Topic ID: ${id}`);
    const unit=topic.unit,assignment=topic.groundingAssignment,window=options.sourceWindows.get(id);
    if(!window||!Number.isSafeInteger(window.start)||!Number.isSafeInteger(window.end)||window.start<1||window.end<window.start)throw new Error(`invalid source window for ${id}`);
    if(!assignment||assignment.status!=="BLOCKED")throw new Error(`extraction-only Topic must currently be BLOCKED: ${id}`);
    if(unit.groundingVersion===null||!unit.groundingSourceFingerprint||!unit.groundingNotesJson)throw new Error(`Topic Unit has no current grounding identity: ${id}`);
    const assignmentIdentityMatches=assignment.unitGroundingVersion===unit.groundingVersion&&assignment.unitSourceFingerprint===unit.groundingSourceFingerprint&&(assignment.method==="AI_MAPPER"?assignment.mapperPromptVersion===MAPPER_PROMPT_VERSION:assignment.assignmentVersion===DETERMINISTIC_ASSIGNMENT_VERSION);
    if(!assignmentIdentityMatches)throw new Error(`Topic assignment identity is stale: ${id}`);
    if(!Number.isSafeInteger(unit.sourcePageStart)||!Number.isSafeInteger(unit.sourcePageEnd)||unit.sourcePageStart<1||unit.sourcePageEnd<unit.sourcePageStart||window.start<unit.sourcePageStart||window.end>unit.sourcePageEnd)throw new Error(`source window is outside the current Unit page range for ${id}`);
    const sourceKey=resolveEffectiveSourceFile(unit,unit.subject);if(!sourceKey?.trim())throw new Error(`No source context for ${id}`);
    sources.set(id,sourceKey);
  }
  return sources;
}

async function runExtractionOnly(options:RemediationOptions,topics:Map<string,any>,sources:Map<string,string>,deps:Dependencies):Promise<RemediationSummary>{
  const report=emptySummary(options.apply,true);report.requestedTopics=options.topicIds.length;
  if(!options.apply){
    for(const id of options.topicIds){const topic=topics.get(id),window=options.sourceWindows.get(id)!;report.processedTopics++;report.finalBlocked++;report.topics.push({topicId:id,topicName:topic.nameEn,unitId:topic.unit.id,unitName:topic.unit.nameEn,before:"BLOCKED",after:"BLOCKED",path:"SOURCE_EXTRACTION_ONLY",sourceWindow:window,wouldPerformSideEffects:true,factualIdentity:{groundingVersion:topic.unit.groundingVersion,sourceFingerprint:topic.unit.groundingSourceFingerprint},unitGroundingAvailable:true,reusableReady:false});}
    return report;
  }
  const model=await deps.activeModel();if(!model)throw new Error("No active source-evidence extractor model");
  for(const id of options.topicIds){
    const topic=topics.get(id),unit=topic.unit,window=options.sourceWindows.get(id)!;
    const identity={topicId:id,unitId:unit.id,sourceFingerprint:unit.groundingSourceFingerprint,sourcePageStart:window.start,sourcePageEnd:window.end,promptVersion:"topic-source-evidence-v1",extractorModel:model};
    const base={topicId:id,topicName:topic.nameEn,unitId:unit.id,unitName:unit.nameEn,before:"BLOCKED",after:"BLOCKED",path:"SOURCE_EXTRACTION_ONLY" as const,sourceWindow:window,wouldPerformSideEffects:true,factualIdentity:{groundingVersion:unit.groundingVersion,sourceFingerprint:unit.groundingSourceFingerprint},unitGroundingAvailable:true,reusableReady:false};
    let evidence=await deps.sourceEvidence.getReusable(identity);
    if(evidence?.status==="NOT_FOUND"){report.sourceEvidenceNotFound++;report.finalBlocked++;report.processedTopics++;report.topics.push({...base,path:"NO_ACTION",wouldPerformSideEffects:false,notFoundSourceEvidence:true});continue;}
    if(evidence?.status!=="READY"){report.sourceExtractionAttempted++;evidence=await deps.sourceEvidence.prepareTopicEvidence(identity,{sourceKey:sources.get(id)!,curriculumCode:topic.unit.subject.grade.curriculum.code,gradeLevel:topic.unit.subject.grade.level,topicName:topic.nameEn,unitName:topic.unit.nameEn,subjectName:topic.unit.subject.nameEn});}
    if(evidence?.status==="NOT_FOUND"){report.sourceEvidenceNotFound++;report.finalBlocked++;report.processedTopics++;report.topics.push({...base,wouldPerformSideEffects:true,notFoundSourceEvidence:true});continue;}
    if(evidence?.status!=="READY"){if(evidence?.status==="FAILED")report.sourceEvidenceFailed++;report.finalBlocked++;report.processedTopics++;report.topics.push({...base});continue;}
    report.sourceEvidenceReady++;
    const prepared=await deps.assignment.assignGroundingForTopic(id);
    if(!(prepared.outcome==="ASSIGNED"||prepared.outcome==="UNCHANGED"&&prepared.status==="READY")){report.finalBlocked++;report.processedTopics++;report.topics.push({...base});continue;}
    const fresh=await deps.prisma.client.topic.findUnique({where:{id},include:{groundingAssignment:true,topicSourceEvidence:{where:{status:"READY"}},unit:{select:{id:true,groundingNotesJson:true,groundingVersion:true,groundingSourceFingerprint:true}}}});
    const resolved=fresh?.groundingAssignment&&fresh.unit?resolveAssignedGroundingSlice(fresh.groundingAssignment,{id:unit.id,groundingVersion:unit.groundingVersion,groundingSourceFingerprint:unit.groundingSourceFingerprint,groundingNotesJson:unit.groundingNotesJson},fresh.topicSourceEvidence):{state:"MISSING" as const};
    if(resolved.state==="READY"&&resolved.slice.concepts.length+resolved.slice.facts.length+resolved.slice.vocabulary.length>0){
      const pages=[...new Set([...resolved.slice.concepts.flatMap(x=>x.sourcePages),...resolved.slice.facts.flatMap(x=>x.sourcePages),...resolved.slice.vocabulary.flatMap(x=>x.sourcePages)])].sort((a,b)=>a-b);report.readyAfter++;report.processedTopics++;report.topics.push({...base,after:"READY",downstreamSliceVerified:true,sourcePages:pages});continue;
    }
    const freshAssignment=fresh?.groundingAssignment;
    if(freshAssignment?.status==="READY")await deps.assignment.upsert({topicId:id,unitGroundingVersion:unit.groundingVersion,unitSourceFingerprint:unit.groundingSourceFingerprint,method:freshAssignment.method,confidence:"LOW",status:"BLOCKED",matchedConceptNames:[],matchedHintTitles:null,mapperModel:freshAssignment.mapperModel??null,mapperPromptVersion:freshAssignment.method==="AI_MAPPER"?MAPPER_PROMPT_VERSION:null,reason:"Source evidence produced an empty downstream grounding slice."});
    report.finalBlocked++;report.processedTopics++;report.topics.push({...base,after:"BLOCKED",downstreamSliceVerified:false});
  }
  return report;
}

export async function runRemediation(options:RemediationOptions,deps:Dependencies):Promise<RemediationSummary>{
  const rows=await deps.prisma.client.topic.findMany({where:{id:{in:options.topicIds}},include:{groundingAssignment:true,topicSourceEvidence:true,unit:{include:{topics:{select:{id:true,nameEn:true,order:true}},subject:{include:{grade:{include:{curriculum:true}}}}}}}});const byId=new Map<string,any>(rows.map((r:any)=>[r.id,r]));const unknown=options.topicIds.filter(id=>!byId.has(id));if(unknown.length)throw new Error(`Unknown Topic IDs: ${unknown.join(",")}`);
  if(options.sourceExtractionOnly){if(new Set(options.topicIds).size!==options.topicIds.length)throw new Error("duplicate Topic IDs are not allowed in extraction-only mode");if(options.sourceWindows.size!==options.topicIds.length)throw new Error("extraction-only mode requires one explicit source window per Topic");const sources=validateExtractionOnlyBatch(options,byId);return runExtractionOnly(options,byId,sources,deps);}
  for(const[id]of options.sourceWindows){const t=byId.get(id);if(!resolveEffectiveSourceFile(t.unit,t.unit.subject))throw new Error(`No source context for ${id}`);}
  const report=emptySummary(options.apply);report.requestedTopics=options.topicIds.length;
  for(const id of options.topicIds){const topic=byId.get(id),wasReady=reusable(topic);if(wasReady)report.readyBefore++;const base={topicId:id,topicName:topic.nameEn,unitId:topic.unit.id,unitName:topic.unit.nameEn,before:topic.groundingAssignment?.status??"MISSING",after:topic.groundingAssignment?.status??"MISSING"};if(wasReady){report.reusedReady++;report.readyAfter++;report.processedTopics++;report.topics.push({...base,path:"REUSE_READY",wouldPerformSideEffects:false});continue;}const window=options.sourceWindows.get(id);
    if(!options.apply){const hasGrounding=!!topic.unit.groundingNotesJson&&topic.unit.groundingVersion!=null&&!!topic.unit.groundingSourceFingerprint;const matching=(topic.topicSourceEvidence??[]).filter((e:any)=>e.unitId===topic.unit.id&&e.sourceFingerprint===topic.unit.groundingSourceFingerprint);const hasReadyEvidence=matching.some((e:any)=>e.status==="READY"),hasNotFound=matching.some((e:any)=>e.status==="NOT_FOUND");const notes=mergePlanningEvidence(topic.unit.groundingNotesJson,matching);const siblings=(topic.unit.topics??[{id:topic.id,nameEn:topic.nameEn,order:topic.order}]);const deterministic=notes?computeDeterministicAssignment(notes,{id:topic.id,nameEn:topic.nameEn,order:topic.order},siblings):null;const candidates=notes?prefilterCompactCandidates(topic.nameEn,notes):[];const path:RemediationPath=deterministic?"DETERMINISTIC":candidates.length?"COMPACT_MAPPER":window?"SOURCE_EXTRACTION":hasNotFound?"NO_ACTION":"BLOCKED_NO_AUTHORIZED_SOURCE_WINDOW";report.processedTopics++;if(path!=="DETERMINISTIC")report.finalBlocked++;report.topics.push({...base,path,sourceWindow:window,wouldPerformSideEffects:path!=="NO_ACTION"&&path!=="BLOCKED_NO_AUTHORIZED_SOURCE_WINDOW",factualIdentity:{groundingVersion:topic.unit.groundingVersion,sourceFingerprint:topic.unit.groundingSourceFingerprint},reusableReady:false,unitGroundingAvailable:hasGrounding,readySourceEvidence:hasReadyEvidence,notFoundSourceEvidence:hasNotFound,candidateCount:candidates.length,candidateTypes:[...new Set(candidates.map(c=>c.type))],deterministicMethod:deterministic?.method??null});continue;}
    const deterministic=await deps.assignment.assignGroundingForTopic(id);if(deterministic.outcome==="ASSIGNED"||deterministic.outcome==="UNCHANGED"&&deterministic.status==="READY"){report.deterministicRecovered++;report.readyAfter++;report.processedTopics++;report.topics.push({...base,path:"DETERMINISTIC",after:"READY",wouldPerformSideEffects:true});continue;}
    let model:string|undefined;let identity:any;if(window){model=await deps.activeModel();identity={topicId:id,unitId:topic.unit.id,sourceFingerprint:topic.unit.groundingSourceFingerprint,sourcePageStart:window.start,sourcePageEnd:window.end,promptVersion:"topic-source-evidence-v1",extractorModel:model};const terminal=(topic.topicSourceEvidence??[]).find((e:any)=>e.status==="NOT_FOUND"&&e.topicId===id&&e.unitId===topic.unit.id&&e.sourceFingerprint===identity.sourceFingerprint&&e.sourcePageStart===window.start&&e.sourcePageEnd===window.end&&e.promptVersion===identity.promptVersion&&e.extractorModel===model);if(terminal){report.sourceEvidenceNotFound++;report.finalBlocked++;report.processedTopics++;report.topics.push({...base,path:"NO_ACTION",sourceWindow:window,after:"BLOCKED",wouldPerformSideEffects:false});continue;}}
    report.compactMapperAttempted++;const mapped=await deps.mapper.mapTopic(id);if(mapped.outcome==="READY"){report.compactMapperRecovered++;report.readyAfter++;report.processedTopics++;report.topics.push({...base,path:"COMPACT_MAPPER",after:"READY",wouldPerformSideEffects:true});continue;}if(!window){report.finalBlocked++;report.processedTopics++;report.topics.push({...base,path:"BLOCKED_NO_AUTHORIZED_SOURCE_WINDOW",wouldPerformSideEffects:false});continue;}
    report.sourceExtractionAttempted++;const evidence=await deps.sourceEvidence.prepareTopicEvidence(identity,{sourceKey:resolveEffectiveSourceFile(topic.unit,topic.unit.subject)!,curriculumCode:topic.unit.subject.grade.curriculum.code,gradeLevel:topic.unit.subject.grade.level,topicName:topic.nameEn,unitName:topic.unit.nameEn,subjectName:topic.unit.subject.nameEn});
    if(evidence.status==="READY"){report.sourceEvidenceReady++;const final=await deps.assignment.assignGroundingForTopic(id);if(final.outcome==="ASSIGNED"||final.outcome==="UNCHANGED"&&final.status==="READY"){report.readyAfter++;report.processedTopics++;report.topics.push({...base,path:"SOURCE_EXTRACTION",sourceWindow:window,after:"READY",wouldPerformSideEffects:true});continue;}}if(evidence.status==="NOT_FOUND")report.sourceEvidenceNotFound++;else if(evidence.status==="FAILED")report.sourceEvidenceFailed++;report.finalBlocked++;report.processedTopics++;report.topics.push({...base,path:"SOURCE_EXTRACTION",sourceWindow:window,after:"BLOCKED",wouldPerformSideEffects:true});
  }return report;
}

async function main(){const options=parseRemediationArgs();const app=await NestFactory.createApplicationContext(AppModule,{logger:false});try{const prisma=app.get(PrismaService),assignment=app.get(TopicGroundingAssignmentService),provider=app.get(AIProviderFactory);const mapper=new TopicGroundingMapperService(prisma,provider,app.get(AIUsageService),assignment),sourceEvidence=app.get(TopicSourceEvidenceService);console.log(JSON.stringify(await runRemediation(options,{prisma,assignment,mapper,sourceEvidence,activeModel:async()=>(await provider.getActiveProvider()).model}),null,2));}finally{await app.close();}}
if(require.main===module)main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=2;});
function mergePlanningEvidence(notes:any,rows:any[]){if(!notes)return null;const merged={...notes,concepts:[...(notes.concepts??[])],facts:[...(notes.facts??[])],vocabulary:[...(notes.vocabulary??[])],learningObjectives:[...(notes.learningObjectives??[])],topicHints:[...(notes.topicHints??[])]};for(const row of rows){if(row.status!=="READY"||!Array.isArray(row.evidenceJson))continue;for(const i of row.evidenceJson){if(i.type==="concept")merged.concepts.push({name:i.label,description:i.label,sourcePages:i.sourcePages??[],importance:"core"});else if(i.type==="fact")merged.facts.push({fact:i.label,sourcePages:i.sourcePages??[],importance:"core"});else if(i.type==="vocabulary")merged.vocabulary.push({term:i.label,meaning:i.label,sourcePages:i.sourcePages??[]});}}return merged;}
