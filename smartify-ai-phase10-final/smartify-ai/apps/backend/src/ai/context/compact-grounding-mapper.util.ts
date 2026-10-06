export const COMPACT_TYPES = ["fact","skill","concept","scopeNote","topicHint","vocabulary","learningObjective"] as const;
export type CompactType = typeof COMPACT_TYPES[number];
export interface CompactCandidate { type: CompactType; index: number; label: string; sourcePages?: number[]; provenance?: unknown }
const norm=(s:string)=>s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
export function prefilterCompactCandidates(topicText:string, notes:any, max=24): CompactCandidate[] {
  const terms=new Set(norm(topicText).split(/\s+/).filter(x=>x.length>2)); const out:CompactCandidate[]=[];
  const add=(type:CompactType, arr:any[], label:(x:any)=>string)=>arr.forEach((x,i)=>{const l=label(x); const n=norm(l); if([...terms].some(t=>n.includes(t)||t.includes(n))||terms.size===0) out.push({type,index:i,label:l,sourcePages:x.sourcePages});});
  add("fact",notes.facts??[],x=>x.fact); add("skill",notes.skills??[],x=>String(x)); add("concept",notes.concepts??[],x=>x.name); add("scopeNote",notes.scopeNotes??[],x=>String(x)); add("topicHint",notes.topicHints??[],x=>x.topicTitle); add("vocabulary",notes.vocabulary??[],x=>x.term); add("learningObjective",notes.learningObjectives??[],x=>String(x));
  return out.slice(0,max);
}
export function validateCompactResponse(value: unknown, candidates: CompactCandidate[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_RESPONSE");
  const o=value as Record<string,unknown>;
  if (o.supported===false && Object.keys(o).length===1) return {supported:false as const};
  if (o.supported!==true || !Array.isArray(o.matches) || Object.keys(o).some(k=>k!=="supported"&&k!=="matches")) throw new Error("INVALID_RESPONSE");
  const seen=new Set<string>(); const matches=(o.matches as unknown[]).map(m=>{if(!m||typeof m!=="object"||Array.isArray(m))throw new Error("INVALID_MATCH"); const x=m as Record<string,unknown>; if(Object.keys(x).length!==2||typeof x.type!=="string"||!Number.isInteger(x.index))throw new Error("INVALID_MATCH"); const key=`${x.type}:${x.index}`; if(seen.has(key)||!candidates.some(c=>c.type===x.type&&c.index===x.index))throw new Error("INVALID_MATCH"); seen.add(key); return {type:x.type,index:x.index as number};});
  return {supported:true as const,matches};
}
