const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const topicId = 'cmucxcu9e00dd2qd528ec4nk1';

  const unitIds = [
    'cmucxctoe004f2qd5rqf67e97',
    'cmucxcu9c00db2qd5ohz6oa3g'
  ];

  const topic = await prisma.topic.findUnique({
    where: { id: topicId },
    select: {
      id: true,
      nameEn: true,
      nameAr: true,
      unitId: true,
      unit: {
        select: {
          id: true,
          nameEn: true,
          nameAr: true,
          sourceFileOverride: true,
          sourcePageStart: true,
          sourcePageEnd: true,
          groundingVersion: true,
          groundingNotesJson: true,
          subjectId: true,
          subject: {
            select: {
              id: true,
              nameEn: true,
              sourceFile: true,
              grade: {
                select: {
                  id: true,
                  nameEn: true,
                  level: true,
                  curriculum: {
                    select: {
                      id: true,
                      code: true,
                      nameEn: true
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  const units = await prisma.unit.findMany({
    where: { id: { in: unitIds } },
    select: {
      id: true,
      nameEn: true,
      nameAr: true,
      subjectId: true,
      sourceFileOverride: true,
      sourcePageStart: true,
      sourcePageEnd: true,
      groundingVersion: true,
      groundingNotesJson: true,
      subject: {
        select: {
          id: true,
          nameEn: true,
          sourceFile: true,
          grade: {
            select: {
              id: true,
              nameEn: true,
              level: true,
              curriculum: {
                select: {
                  id: true,
                  code: true,
                  nameEn: true
                }
              }
            }
          }
        }
      }
    }
  });

  const summarize = (row) => {
    const notes = row.groundingNotesJson;

    return {
      id: row.id,
      nameEn: row.nameEn,
      subjectId: row.subjectId,
      sourceFileOverride: row.sourceFileOverride,
      effectiveSourceFile:
        row.sourceFileOverride ?? row.subject?.sourceFile ?? null,
      sourcePageStart: row.sourcePageStart,
      sourcePageEnd: row.sourcePageEnd,
      groundingVersion: row.groundingVersion,
      groundingConceptCount:
        Array.isArray(notes?.concepts) ? notes.concepts.length : 0,
      groundingConceptNames:
        Array.isArray(notes?.concepts)
          ? notes.concepts.slice(0, 20).map(c => c?.name).filter(Boolean)
          : [],
      subject: row.subject && {
        id: row.subject.id,
        nameEn: row.subject.nameEn,
        sourceFile: row.subject.sourceFile,
        grade: row.subject.grade && {
          id: row.subject.grade.id,
          nameEn: row.subject.grade.nameEn,
          level: row.subject.grade.level,
          curriculum: row.subject.grade.curriculum
        }
      }
    };
  };

  console.log(JSON.stringify({
    topic: topic && {
      id: topic.id,
      nameEn: topic.nameEn,
      unitId: topic.unitId,
      unit: topic.unit && summarize(topic.unit)
    },
    comparedUnits: units.map(summarize)
  }, null, 2));
})()
.catch(error => {
  console.error(error.message);
  process.exitCode = 1;
})
.finally(() => prisma.$disconnect());
