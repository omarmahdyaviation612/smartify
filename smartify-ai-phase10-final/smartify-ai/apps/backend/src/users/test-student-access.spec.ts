import { UsersService } from "./users.service";
import { ForbiddenException } from "@nestjs/common";
import { UserRole } from "@smartify/shared-types";
function harness(role="STUDENT") {
  const tx={user:{findUnique:jest.fn().mockResolvedValue({id:"student",role,isActive:true,isTestStudent:false}),update:jest.fn().mockResolvedValue({id:"student",isTestStudent:true})},auditLog:{create:jest.fn()}};
  return {tx,service:new UsersService({client:{$transaction:(fn:any)=>fn(tx)}} as any)};
}
for(const role of [UserRole.STUDENT,UserRole.ADMIN,UserRole.SUPPORT]) test(`${role} cannot enable test access`,async()=>{
  const h=harness(); await expect(h.service.setTestStudentAccess("actor",role,"student",true)).rejects.toThrow(ForbiddenException); expect(h.tx.user.update).not.toHaveBeenCalled();
});
test("Super Admin test-access update changes only the server flag and writes an audit record",async()=>{
  const h=harness();await h.service.setTestStudentAccess("owner",UserRole.SUPER_ADMIN,"student",true);
  expect(h.tx.user.update).toHaveBeenCalledWith({where:{id:"student"},data:{isTestStudent:true}});
  expect(h.tx.auditLog.create.mock.calls[0][0].data).toMatchObject({action:"TEST_STUDENT_ACCESS_UPDATED",entityId:"student"});
});
test("test access cannot target admin accounts",async()=>{
  const h=harness("ADMIN");await expect(h.service.setTestStudentAccess("owner",UserRole.SUPER_ADMIN,"student",true)).rejects.toThrow(ForbiddenException);
  expect(h.tx.user.update).not.toHaveBeenCalled();
});
