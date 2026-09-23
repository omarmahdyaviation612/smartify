import * as path from "path";

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function defaultObjectKey(curriculumCode: string, gradeLevel: number, subjectNameEn: string, filename: string): string {
  const base = slugify(path.basename(filename, path.extname(filename))) + ".pdf";
  return [slugify(curriculumCode), `grade-${gradeLevel}`, slugify(subjectNameEn), base].join("/");
}
