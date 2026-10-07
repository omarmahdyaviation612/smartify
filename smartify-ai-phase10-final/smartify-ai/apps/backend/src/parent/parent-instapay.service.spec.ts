import { ForbiddenException } from "@nestjs/common";
import { ParentInstapayService } from "./parent-instapay.service";

describe("ParentInstapayService", () => {
  it("verifies the child link before initiating payment as that child", async () => {
    const parents = { assertLinkedStudent: jest.fn().mockResolvedValue({ id: "child-1", userId: "child-user" }) } as any;
    const instapay = { initiateSubscription: jest.fn().mockResolvedValue({ referenceId: "ref" }) } as any;
    const service = new ParentInstapayService(parents, instapay);
    await expect(service.initiateSubscription("parent-user", "child-1", { subjectIds: ["subject-1"] })).resolves.toEqual({ referenceId: "ref" });
    expect(parents.assertLinkedStudent).toHaveBeenCalledWith("parent-user", "child-1");
    expect(instapay.initiateSubscription).toHaveBeenCalledWith("child-user", { subjectIds: ["subject-1"] });
  });
  it("never reaches billing when the child is not linked", async () => {
    const parents = { assertLinkedStudent: jest.fn().mockRejectedValue(new ForbiddenException()) } as any;
    const instapay = { initiateSubscription: jest.fn() } as any;
    const service = new ParentInstapayService(parents, instapay);
    await expect(service.initiateSubscription("parent-user", "other-child", { subjectIds: ["subject-1"] })).rejects.toThrow(ForbiddenException);
    expect(instapay.initiateSubscription).not.toHaveBeenCalled();
  });
});
