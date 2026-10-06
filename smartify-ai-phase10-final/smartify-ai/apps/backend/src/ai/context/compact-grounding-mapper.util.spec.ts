import { validateCompactResponse, prefilterCompactCandidates } from "./compact-grounding-mapper.util";
const c:any[]=[{type:"concept",index:0,label:"Root",sourcePages:[1]}];
describe("compact grounding contract",()=>{
 it("accepts supported and false",()=>{expect(validateCompactResponse({supported:true,matches:[{type:"concept",index:0}]},c)).toEqual({supported:true,matches:[{type:"concept",index:0}]});expect(validateCompactResponse({supported:false},c)).toEqual({supported:false});});
 it("rejects invented/duplicate/extra",()=>{expect(()=>validateCompactResponse({supported:true,matches:[{type:"fact",index:0}]},c)).toThrow();expect(()=>validateCompactResponse({supported:true,matches:[{type:"concept",index:0},{type:"concept",index:0}]},c)).toThrow();expect(()=>validateCompactResponse({supported:false,x:1},c)).toThrow();});
 it("prefilters deterministically and preserves indexes",()=>{const n:any={concepts:[{name:"Fractions",sourcePages:[2]}],facts:[{fact:"A fact",sourcePages:[1]}],skills:[],scopeNotes:[],topicHints:[],vocabulary:[],learningObjectives:[]};expect(prefilterCompactCandidates("Fractions",n)).toEqual([{type:"concept",index:0,label:"Fractions",sourcePages:[2]}]);});
});
