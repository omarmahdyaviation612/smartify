import { Injectable } from "@nestjs/common";
import { InstapayService, type ReceiptFile } from "../instapay/instapay.service";
import { ParentService } from "./parent.service";

@Injectable()
export class ParentInstapayService {
  constructor(private readonly parents: ParentService, private readonly instapay: InstapayService) {}
  async initiateSubscription(parentUserId: string, studentId: string, input: { subjectIds: string[]; homeworkAddon?: boolean; homeworkAddonAllowance?: number }) {
    const student = await this.parents.assertLinkedStudent(parentUserId, studentId);
    return this.instapay.initiateSubscription(student.userId, input);
  }
  async initiateQuestionPack(parentUserId: string, studentId: string, subjectId: string) {
    const student = await this.parents.assertLinkedStudent(parentUserId, studentId);
    return this.instapay.initiateQuestionPack(student.userId, subjectId);
  }
  async submitReceipt(parentUserId: string, studentId: string, input: { referenceId: string; submittedAmountEGP: number; senderName?: string; note?: string }, file?: ReceiptFile) {
    const student = await this.parents.assertLinkedStudent(parentUserId, studentId);
    return this.instapay.submitReceipt(student.userId, input, file);
  }
  async listSubmissions(parentUserId: string, studentId: string) {
    const student = await this.parents.assertLinkedStudent(parentUserId, studentId);
    return this.instapay.listMine(student.userId);
  }
}
