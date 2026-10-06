import { Injectable } from "@nestjs/common";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { invokePdfRenderer } from "./pdf-renderer-runtime";
import { CurriculumSourceStorageFactory } from "./storage/curriculum-source-storage.factory";

@Injectable()
export class GroundingSourceExtractionService {
  constructor(private readonly storageFactory: CurriculumSourceStorageFactory) {}
  async renderSourcePages(sourceKey:string, curriculumCode:string, gradeLevel:number, start:number, end:number) {
    if (start < 1 || end < start) throw new Error("INVALID_SOURCE_WINDOW");
    const fetched=await this.storageFactory.get().fetchToTempFile(sourceKey,{curriculumCode,gradeLevel});
    const tmpDir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),"smartify-grounding-shared-"));
    try { const {stdout}=await invokePdfRenderer([fetched.localPath,String(start),String(end),tmpDir]); const imagePaths=stdout.split("\n").map(x=>x.trim()).filter(Boolean); if(imagePaths.length!==end-start+1) throw new Error("RENDERER_PAGE_COUNT_MISMATCH"); const imageDataUrls=imagePaths.map((imagePath,index)=>({index:index+1,dataUrl:`data:image/png;base64,${fs.readFileSync(imagePath).toString("base64")}`})); return {imageDataUrls,start,end}; }
    finally { fs.rmSync(tmpDir,{recursive:true,force:true}); if(fetched.isTemporary) fs.rmSync(path.dirname(fetched.localPath),{recursive:true,force:true}); }
  }
}
