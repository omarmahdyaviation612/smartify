import { GroundingSourceExtractionService } from "./grounding-source-extraction.service";
import * as renderer from "./pdf-renderer-runtime";
import * as fs from "fs";
import * as path from "path";

describe("GroundingSourceExtractionService", () => {
  it("materializes usable payload before cleaning the exact rendered range", async () => {
    const storage: any = { fetchToTempFile: jest.fn().mockResolvedValue({ localPath: "x.pdf", isTemporary: false }) };
    jest.spyOn(renderer, "invokePdfRenderer").mockImplementation(async (args: any[]) => {
      const a = path.join(args[3], "a.png"), b = path.join(args[3], "b.png");
      fs.writeFileSync(a, "png"); fs.writeFileSync(b, "png");
      return { stdout: `${a}\n${b}\n`, stderr: "" };
    });
    const service = new GroundingSourceExtractionService({ get: () => storage } as any);
    const result = await service.renderSourcePages("book", "cur", 1, 4, 5);
    expect(result.imageDataUrls).toEqual([{ index: 1, dataUrl: "data:image/png;base64,cG5n" }, { index: 2, dataUrl: "data:image/png;base64,cG5n" }]);
    expect(fs.existsSync((renderer.invokePdfRenderer as jest.Mock).mock.calls[0][0][3])).toBe(false);
  });
});
