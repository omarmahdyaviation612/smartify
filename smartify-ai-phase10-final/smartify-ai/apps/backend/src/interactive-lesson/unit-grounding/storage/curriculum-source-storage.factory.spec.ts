import { ServiceUnavailableException } from "@nestjs/common";

jest.mock("@smartify/config", () => ({ loadBackendEnv: jest.fn() }));

import { loadBackendEnv } from "@smartify/config";
import { CurriculumSourceStorageFactory } from "./curriculum-source-storage.factory";
import { LocalCurriculumSourceStorage } from "./local-curriculum-source-storage.service";
import { S3CurriculumSourceStorage } from "./s3-curriculum-source-storage.service";

const mockLoadBackendEnv = loadBackendEnv as jest.Mock;

describe("CurriculumSourceStorageFactory", () => {
  beforeEach(() => {
    mockLoadBackendEnv.mockClear();
  });

  it("test L: no CURRICULUM_STORAGE_PROVIDER, only CURRICULUM_SOURCES_DIR set — resolves LocalCurriculumSourceStorage (the local-dev/admin fallback)", () => {
    mockLoadBackendEnv.mockReturnValue({ CURRICULUM_SOURCES_DIR: "D:\\fake-curriculum-sources" });
    const factory = new CurriculumSourceStorageFactory();
    expect(factory.get()).toBeInstanceOf(LocalCurriculumSourceStorage);
  });

  it('CURRICULUM_STORAGE_PROVIDER="local" explicitly set — also resolves LocalCurriculumSourceStorage', () => {
    mockLoadBackendEnv.mockReturnValue({ CURRICULUM_STORAGE_PROVIDER: "local", CURRICULUM_SOURCES_DIR: "D:\\fake-curriculum-sources" });
    const factory = new CurriculumSourceStorageFactory();
    expect(factory.get()).toBeInstanceOf(LocalCurriculumSourceStorage);
  });

  it('CURRICULUM_STORAGE_PROVIDER="s3" with a bucket configured — resolves S3CurriculumSourceStorage', () => {
    mockLoadBackendEnv.mockReturnValue({ CURRICULUM_STORAGE_PROVIDER: "s3", CURRICULUM_S3_BUCKET: "fake-bucket", CURRICULUM_S3_REGION: "auto" });
    const factory = new CurriculumSourceStorageFactory();
    expect(factory.get()).toBeInstanceOf(S3CurriculumSourceStorage);
  });

  it("neither S3 nor a local directory is configured — throws a clear, catchable error rather than crashing the app at boot", () => {
    mockLoadBackendEnv.mockReturnValue({});
    const factory = new CurriculumSourceStorageFactory();
    expect(() => factory.get()).toThrow(ServiceUnavailableException);
  });

  it("caches the resolved storage instance — only resolves configuration once per factory instance", () => {
    mockLoadBackendEnv.mockReturnValue({ CURRICULUM_SOURCES_DIR: "D:\\fake-curriculum-sources" });
    const factory = new CurriculumSourceStorageFactory();
    const first = factory.get();
    const second = factory.get();
    expect(first).toBe(second);
    expect(mockLoadBackendEnv).toHaveBeenCalledTimes(1);
  });
});
