import { GroundingVisionExecutionService } from "./grounding-vision-execution.service";
import { CONTENT_AUTHORING_ACTOR_ID } from "../../ai/content-authoring-actor.const";
describe("GroundingVisionExecutionService",()=>{function h(generate:any){const provider={generate:jest.fn(generate)};const prisma:any={client:{aIUsage:{create:jest.fn().mockResolvedValue(undefined)}}};const providers:any={getActiveProvider:jest.fn().mockResolvedValue({provider,providerKey:"openai",model:"gpt"}),getCostRates:jest.fn().mockResolvedValue({costPerInputToken:1,costPerOutputToken:1})};const usage:any={estimateMaxChatCostUsd:jest.fn().mockResolvedValue(1),reserveBudget:jest.fn().mockResolvedValue({ok:true,reservationId:"r"}),reconcileBudget:jest.fn().mockResolvedValue(undefined),releaseBudget:jest.fn().mockResolvedValue(undefined)};return {s:new GroundingVisionExecutionService(prisma,providers,usage),provider,prisma,providers,usage};}
it("executes once and accounts",async()=>{const x=h(async()=>({content:'{}',inputTokens:1,outputTokens:2}));await x.s.execute({systemPrompt:"p",messages:[],feature:"f"});expect(x.provider.generate).toHaveBeenCalledTimes(1);expect(x.usage.reserveBudget).toHaveBeenCalledWith(CONTENT_AUTHORING_ACTOR_ID,1);expect(x.prisma.client.aIUsage.create).toHaveBeenCalledTimes(1);});
it("shared context reserves once and releases once on terminal failure",async()=>{const x=h(async()=>{throw new Error("fail")});const c=await x.s.createAccountingContext({inputText:"p"});await expect(x.s.execute({systemPrompt:"p",messages:[],feature:"f",accountingContext:c})).rejects.toThrow();await x.s.finalizeFailure(c);await x.s.finalizeFailure(c);expect(x.usage.reserveBudget).toHaveBeenCalledTimes(1);expect(x.usage.releaseBudget).toHaveBeenCalledTimes(1);});
});



describe("GroundingVisionExecutionService image-aware reservation",()=>{
 // Minimal PNG signature + IHDR header: pngDimensions reads only width/height.
 const png=(width:number,height:number)=>{const b=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(b,0);b.writeUInt32BE(13,8);b.write("IHDR",12,"ascii");b.writeUInt32BE(width,16);b.writeUInt32BE(height,20);return{dataUrl:`data:image/png;base64,${b.toString("base64")}`};};
 const page=()=>png(1240,1754); // A4 at the renderer's 150 dpi
 const rate=0.15/1e6,outRate=0.6/1e6;
 function h(opts:{limitUsd?:number;generate?:any}={}){const provider={generate:jest.fn(opts.generate??(async()=>({content:"{}",inputTokens:1000,outputTokens:5})))};const prisma:any={client:{aIUsage:{create:jest.fn().mockResolvedValue(undefined)}}};const providers:any={getActiveProvider:jest.fn().mockResolvedValue({provider,providerKey:"openai",model:"gpt-4o-mini"}),getCostRates:jest.fn().mockResolvedValue({costPerInputToken:rate,costPerOutputToken:outRate})};
  const usage:any={estimateMaxChatCostUsd:jest.fn(async(p:any)=>(p.estimatedInputTokens??Math.ceil(p.inputText.length/3))*rate+(p.maxOutputTokens??1000)*outRate),reserveBudget:jest.fn(async(_actor:string,est:number)=>opts.limitUsd!==undefined&&est>opts.limitUsd?{ok:false,reason:"daily_limit"}:{ok:true,reservationId:"r1"}),reconcileBudget:jest.fn().mockResolvedValue(undefined),releaseBudget:jest.fn().mockResolvedValue(undefined)};
  return{s:new GroundingVisionExecutionService(prisma,providers,usage),provider,usage};}
 const reserved=(x:any)=>x.usage.reserveBudget.mock.calls[0][1] as number;
 it("keeps the text-only estimate unchanged",async()=>{const x=h();await x.s.createAccountingContext({inputText:"p",estimatedInputTokens:1200,maxOutputTokens:600});expect(x.usage.estimateMaxChatCostUsd).toHaveBeenCalledWith(expect.objectContaining({estimatedInputTokens:1200}));expect(reserved(x)).toBeCloseTo(1200*rate+600*outRate,12);});
 it("adds rendered-image tokens to the reservation materially",async()=>{const text=h(),img=h();await text.s.createAccountingContext({inputText:"p",estimatedInputTokens:1200,maxOutputTokens:600});await img.s.createAccountingContext({inputText:"p",estimatedInputTokens:1200,maxOutputTokens:600,images:[page()],imageDetail:"high"});expect(img.usage.estimateMaxChatCostUsd).toHaveBeenCalledWith(expect.objectContaining({estimatedInputTokens:1200+36835}));expect(reserved(img)).toBeGreaterThan(reserved(text)*10);});
 it("scales the reservation with page count",async()=>{const one=h(),many=h();await one.s.createAccountingContext({inputText:"p",estimatedInputTokens:1200,images:[page()]});await many.s.createAccountingContext({inputText:"p",estimatedInputTokens:1200,images:Array.from({length:24},page)});const tokens=(x:any)=>x.usage.estimateMaxChatCostUsd.mock.calls[0][0].estimatedInputTokens;expect(tokens(many)-1200).toBe(24*(tokens(one)-1200));});
 it("uses the low-detail base cost when low detail is requested",async()=>{const x=h();await x.s.createAccountingContext({inputText:"p",estimatedInputTokens:1200,images:[page(),page()],imageDetail:"low"});expect(x.usage.estimateMaxChatCostUsd).toHaveBeenCalledWith(expect.objectContaining({estimatedInputTokens:1200+2*2833}));});
 it("rejects before any provider call when the image estimate exceeds the remaining budget",async()=>{const x=h({limitUsd:0.01});await expect(x.s.createAccountingContext({inputText:"p",estimatedInputTokens:1200,maxOutputTokens:600,images:Array.from({length:24},page)})).rejects.toThrow(/budget reservation refused/);expect(x.provider.generate).not.toHaveBeenCalled();const textOnly=h({limitUsd:0.01});await expect(textOnly.s.createAccountingContext({inputText:"p",estimatedInputTokens:1200,maxOutputTokens:600})).resolves.toMatchObject({reservationId:"r1"});});
 it("fails closed on non-PNG image payloads before reserving",async()=>{const x=h();await expect(x.s.createAccountingContext({inputText:"p",images:[{dataUrl:"data:image/png;base64,YQ=="}]})).rejects.toThrow();expect(x.usage.reserveBudget).not.toHaveBeenCalled();expect(x.provider.generate).not.toHaveBeenCalled();});
 it("reconciles with actual usage, not the image estimate",async()=>{const x=h({generate:async()=>({content:"{}",inputTokens:884233,outputTokens:5})});const c=await x.s.createAccountingContext({inputText:"p",estimatedInputTokens:1200,maxOutputTokens:600,images:Array.from({length:24},page)});await x.s.execute({systemPrompt:"p",messages:[],feature:"TOPIC_SOURCE_EVIDENCE",accountingContext:c});await x.s.finalizeSuccess(c);expect(x.usage.reconcileBudget).toHaveBeenCalledWith("r1",884233*rate+5*outRate);expect(x.provider.generate).toHaveBeenCalledTimes(1);});
 it("still releases the image reservation exactly once on failure",async()=>{const x=h({generate:async()=>{throw new Error("provider down");}});const c=await x.s.createAccountingContext({inputText:"p",images:[page(),page()]});await expect(x.s.execute({systemPrompt:"p",messages:[],feature:"f",accountingContext:c})).rejects.toThrow();await x.s.finalizeFailure(c);await x.s.finalizeFailure(c);expect(x.usage.releaseBudget).toHaveBeenCalledTimes(1);expect(x.usage.releaseBudget).toHaveBeenCalledWith("r1");expect(x.usage.reconcileBudget).not.toHaveBeenCalled();});
});

describe("GroundingVisionExecutionService failure-path accounting", () => {
 function h(generate: any, reconcile: any = jest.fn().mockResolvedValue(undefined)) {
  const provider = { generate: jest.fn(generate) };
  const prisma: any = { client: { aIUsage: { create: jest.fn().mockResolvedValue(undefined) } } };
  const providers: any = { getActiveProvider: jest.fn().mockResolvedValue({ provider, providerKey: "openai", model: "gpt-4o-mini" }), getCostRates: jest.fn().mockResolvedValue({ costPerInputToken: 0.001, costPerOutputToken: 0.002 }) };
  const usage: any = { estimateMaxChatCostUsd: jest.fn().mockResolvedValue(0.5), reserveBudget: jest.fn().mockResolvedValue({ ok: true, reservationId: "r1" }), reconcileBudget: reconcile, releaseBudget: jest.fn().mockResolvedValue(undefined) };
  return { s: new GroundingVisionExecutionService(prisma, providers, usage), provider, usage, prisma };
 }
 const call = (x: any, c: any) => x.s.execute({ systemPrompt: "p", messages: [], feature: "grounding_extraction", accountingContext: c });
 it("1: provider + validation success reconciles actual spend exactly once", async () => {
  const x = h(async () => ({ content: "{}", inputTokens: 100, outputTokens: 10 }));
  const c = await x.s.createAccountingContext({ inputText: "p" }); await call(x, c); await x.s.finalizeSuccess(c); await x.s.finalizeSuccess(c);
  expect(x.usage.reconcileBudget).toHaveBeenCalledTimes(1); expect(x.usage.reconcileBudget).toHaveBeenCalledWith("r1", 100 * 0.001 + 10 * 0.002); expect(x.usage.releaseBudget).not.toHaveBeenCalled();
 });
 it("2: validation failure then retry success commits both attempts' actual spend, once each", async () => {
  const x = h(async () => ({ content: "{}", inputTokens: 100, outputTokens: 10 }));
  const c = await x.s.createAccountingContext({ inputText: "p" }); await call(x, c); await call(x, c); await x.s.finalizeSuccess(c);
  expect(x.provider.generate).toHaveBeenCalledTimes(2); expect(x.prisma.client.aIUsage.create).toHaveBeenCalledTimes(2);
  expect(x.usage.reconcileBudget).toHaveBeenCalledTimes(1); expect(x.usage.reconcileBudget.mock.calls[0][1]).toBeCloseTo(2 * (0.1 + 0.02), 12);
 });
 it("3: every allowed attempt fails validation -> all actual spend committed, nothing released, reservation closed", async () => {
  const x = h(async () => ({ content: "not valid", inputTokens: 200, outputTokens: 5 }));
  const c = await x.s.createAccountingContext({ inputText: "p" }); await call(x, c); await call(x, c); await x.s.finalizeFailure(c); await x.s.finalizeFailure(c);
  expect(x.usage.reconcileBudget).toHaveBeenCalledTimes(1); expect(x.usage.reconcileBudget.mock.calls[0][1]).toBeCloseTo(2 * (0.2 + 0.01), 12);
  expect(x.usage.releaseBudget).not.toHaveBeenCalled();
 });
 it("4: failure before any provider execution releases the reservation and commits no spend", async () => {
  const x = h(async () => ({ content: "{}", inputTokens: 1, outputTokens: 1 }));
  const c = await x.s.createAccountingContext({ inputText: "p" }); await x.s.finalizeFailure(c);
  expect(x.usage.releaseBudget).toHaveBeenCalledWith("r1"); expect(x.usage.reconcileBudget).not.toHaveBeenCalled(); expect(x.provider.generate).not.toHaveBeenCalled();
 });
 it("5: a provider call that fails without billable usage keeps the existing release behavior", async () => {
  const x = h(async () => { throw Object.assign(new Error("boom"), { status: 500 }); });
  const c = await x.s.createAccountingContext({ inputText: "p" }); await expect(call(x, c)).rejects.toThrow("boom"); await x.s.finalizeFailure(c);
  expect(x.usage.releaseBudget).toHaveBeenCalledTimes(1); expect(x.usage.reconcileBudget).not.toHaveBeenCalled(); expect(x.prisma.client.aIUsage.create).not.toHaveBeenCalled();
 });
 it("5b: an earlier successful attempt followed by a failing provider call still commits the earlier spend", async () => {
  let n = 0; const x = h(async () => { if (n++ === 0) return { content: "bad", inputTokens: 100, outputTokens: 10 }; throw Object.assign(new Error("429"), { status: 429 }); });
  const c = await x.s.createAccountingContext({ inputText: "p" }); await call(x, c); await expect(call(x, c)).rejects.toThrow("429"); await x.s.finalizeFailure(c);
  expect(x.usage.reconcileBudget).toHaveBeenCalledWith("r1", 0.1 + 0.02); expect(x.usage.releaseBudget).not.toHaveBeenCalled();
 });
 it("6: reconciliation failure fails safely — the billable reservation is never silently released", async () => {
  const x = h(async () => ({ content: "bad", inputTokens: 100, outputTokens: 10 }), jest.fn().mockRejectedValue(new Error("db down")));
  const c = await x.s.createAccountingContext({ inputText: "p" }); await call(x, c);
  await expect(x.s.finalizeFailure(c)).resolves.toBeUndefined();
  expect(x.usage.reconcileBudget).toHaveBeenCalledTimes(1); expect(x.usage.releaseBudget).not.toHaveBeenCalled(); expect((c as any).reconcileFailed).toBe(true);
 });
});
