import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { dataUrlBytes, isAcceptableImageSrc, scaledSize, MAX_EDGE } from "./image";

describe("scaledSize", () => {
  test("shrinks the longest edge to the cap, keeping the aspect ratio", () => {
    assert.deepEqual(scaledSize(4000, 3000), { width: 1024, height: 768 });
    assert.deepEqual(scaledSize(3000, 4000), { width: 768, height: 1024 });
  });

  test("never enlarges an image already smaller than the cap", () => {
    assert.deepEqual(scaledSize(300, 200), { width: 300, height: 200 });
  });

  test("a square lands exactly on the cap", () => {
    assert.deepEqual(scaledSize(2048, 2048), { width: MAX_EDGE, height: MAX_EDGE });
  });
});

describe("dataUrlBytes", () => {
  test("decodes the payload length, accounting for padding", () => {
    // "hello" -> aGVsbG8= : 5 bytes
    assert.equal(dataUrlBytes("data:image/jpeg;base64,aGVsbG8="), 5);
    // "hi" -> aGk= : 2 bytes
    assert.equal(dataUrlBytes("data:image/jpeg;base64,aGk="), 2);
  });

  test("a string with no payload separator measures zero rather than throwing", () => {
    assert.equal(dataUrlBytes("not-a-data-url"), 0);
  });
});

describe("isAcceptableImageSrc", () => {
  test("accepts the inline images the uploader produces", () => {
    for (const type of ["jpeg", "png", "webp", "gif"]) {
      assert.ok(isAcceptableImageSrc(`data:image/${type};base64,aGVsbG8=`), type);
    }
  });

  test("accepts http(s) URLs, which properties predating the uploader still hold", () => {
    assert.ok(isAcceptableImageSrc("https://example.com/photo.jpg"));
    assert.ok(isAcceptableImageSrc("http://example.com/photo.jpg"));
  });

  // The reason this function exists rather than a bare "starts with data:"
  // check: an HTML data URL stored in an image field is stored XSS the moment
  // anything renders it outside an <img>.
  test("rejects non-image data URLs", () => {
    assert.equal(isAcceptableImageSrc("data:text/html;base64,PHNjcmlwdD4="), false);
    assert.equal(isAcceptableImageSrc("data:application/pdf;base64,aGk="), false);
  });

  test("rejects other schemes outright", () => {
    assert.equal(isAcceptableImageSrc("javascript:alert(1)"), false);
    assert.equal(isAcceptableImageSrc("file:///etc/passwd"), false);
    assert.equal(isAcceptableImageSrc(""), false);
  });

  test("rejects an inline image too large to belong in a row", () => {
    const huge = "data:image/jpeg;base64," + "A".repeat(3_000_000);
    assert.equal(isAcceptableImageSrc(huge), false);
  });
});
