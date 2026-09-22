import { BillingService } from "./billing.service";

// Referral V1 (2026-09-20) — BillingService calls this unconditionally at
// activation now; mocked as a no-op collaborator (this file is about
// webhook retry/idempotency, not referral behavior).
const referralServiceMock = { earnRewardWithinTransaction: jest.fn().mockResolvedValue(undefined) } as any;

describe("payment webhook retries", () => {
  // Transactional persistence boundary: rollback discards all tentative state.
  function setup() {
    let state = { events: [] as string[], status: "pending", grants: 0, checkout: "cs_own" };
    let fail = false;
    let replaceSession = false;
    function client(get: () => typeof state) {
      return {
        webhookEventLog: { create: async ({ data }: any) => {
          if (get().events.includes(data.externalEventId)) throw Object.assign(Error("duplicate"), { code: "P2002" });
          get().events.push(data.externalEventId);
        } },
        subscription: {
          findFirst: async ({ where }: any) => {
            if (where.externalSubscriptionId !== get().checkout || (where.paymentProvider && where.paymentProvider !== "stripe")) return null;
            const found = { id: "sub", status: get().status };
            if (replaceSession) get().checkout = "cs_new";
            return found;
          },
          update: async ({ data }: any) => { if (fail) throw Error("database write failed"); get().status=data.status; get().grants++; },
          updateMany: async ({ where, data }: any) => {
            if (fail) throw Error("database write failed");
            if (where.status && where.status !== get().status) return {count:0};
            if (where.externalSubscriptionId && where.externalSubscriptionId !== get().checkout) return {count:0};
            get().status=data.status; get().grants++; return {count:1};
          },
        },
      };
    }
    const db = {...client(()=>state), $transaction: async (fn: any) => {
      const draft = structuredClone(state);
      const result = await fn(client(()=>draft));
      state=draft;
      return result;
    }};
    return { service: new BillingService({client:db} as any, {} as any, {} as any, referralServiceMock), state:()=>state, fail:(value:boolean)=>{fail=value;}, replaceSession:()=>{replaceSession=true;} };
  }
  const event = {type:"subscription.activated",externalSubscriptionId:"cs_own",externalEventId:"evt"};
  it("rolls back the event marker when activation fails, then permits retry", async () => {
    const f=setup(); f.fail(true);
    await expect(f.service.applyWebhookEvent("stripe",event)).rejects.toThrow("database write failed");
    expect(f.state().events).toEqual([]);
    f.fail(false);
    await f.service.applyWebhookEvent("stripe",event);
    expect(f.state().status).toBe("active");
    expect(f.state().grants).toBe(1);
  });
  it("duplicate and separate paid events for the same checkout do not extend access twice", async () => {
    const f=setup();
    await f.service.applyWebhookEvent("stripe",event);
    await f.service.applyWebhookEvent("stripe",event);
    await f.service.applyWebhookEvent("stripe",{...event,externalEventId:"evt_async"});
    expect(f.state().grants).toBe(1);
  });
  it("does not match a checkout owned by a different payment provider", async () => {
    const f=setup();
    await expect(f.service.applyWebhookEvent("other",event)).rejects.toThrow();
    expect(f.state().grants).toBe(0);
    expect(f.state().events).toEqual([]);
  });
  it("does not activate a replacement checkout when the session changes before the write", async () => {
    const f = setup(); f.replaceSession();
    await f.service.applyWebhookEvent("stripe", event);
    expect(f.state().checkout).toBe("cs_new");
    expect(f.state().status).toBe("pending");
    expect(f.state().grants).toBe(0);
  });
});
