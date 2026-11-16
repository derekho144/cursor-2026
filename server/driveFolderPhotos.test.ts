import { describe, expect, it } from "vitest";
import { extractDriveFolderId } from "./driveFolderPhotos";

describe("extractDriveFolderId", () => {
  it("parses folders URLs and embeddedfolderview", () => {
    expect(
      extractDriveFolderId(
        "https://drive.google.com/drive/folders/1AbCdefGhIjKlMnOpQrsTuvWxYz012345"
      )
    ).toBe("1AbCdefGhIjKlMnOpQrsTuvWxYz012345");
    expect(
      extractDriveFolderId(
        "https://drive.google.com/embeddedfolderview?id=1AbCdefGhIjKlMnOpQrsTuvWxYz012345#grid"
      )
    ).toBe("1AbCdefGhIjKlMnOpQrsTuvWxYz012345");
  });

  it("returns null for unrelated URLs", () => {
    expect(extractDriveFolderId("https://jdstudiohk.com")).toBeNull();
  });
});
