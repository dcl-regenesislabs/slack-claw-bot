import { jest } from "@jest/globals";

// Mock global fetch before importing slack module
const mockFetch = jest.fn() as jest.MockedFunction<typeof globalThis.fetch>;
globalThis.fetch = mockFetch;

// Dynamically import after mocking
const { fetchThread } = await import("../../src/slack.js");

function mockClient(replies: any[] = []) {
  const conversations = {
    replies: jest.fn().mockResolvedValue({ messages: replies }),
  };
  const users = {
    info: jest.fn().mockImplementation(({ user }: { user: string }) =>
      Promise.resolve({ user: { real_name: `User_${user}`, name: user } }),
    ),
  };
  return { conversations, users } as any;
}

describe("fetchThread — image attachment handling", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns images array for messages with image attachments", async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(pngBytes.buffer),
    } as any);

    const messages = [
      {
        user: "U1",
        ts: "1700000000.000001",
        text: "check this screenshot",
        files: [
          {
            name: "screenshot.png",
            mimetype: "image/png",
            url_private: "https://files.slack.com/files-pri/T1/screenshot.png",
            url_private_download: "https://files.slack.com/files-tmb/T1/screenshot.png",
          },
        ],
      },
    ];

    const client = mockClient(messages);
    const result = await fetchThread(client, "C123", "1700000000.000001");

    expect(result.images).toHaveLength(1);
    expect(result.images[0].type).toBe("image");
    expect(result.images[0].mimeType).toBe("image/png");
    expect(result.images[0].data).toBe(Buffer.from(pngBytes).toString("base64"));
    expect(result.content).toContain("[Attached image: screenshot.png]");
  });

  it("handles jpeg, gif, and webp image mimetypes", async () => {
    const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(imageBytes.buffer),
    } as any);

    const messages = [
      {
        user: "U1",
        ts: "1700000000.000001",
        text: "images",
        files: [
          { name: "photo.jpeg", mimetype: "image/jpeg", url_private: "https://files.slack.com/a.jpg", url_private_download: "https://files.slack.com/a.jpg" },
          { name: "anim.gif", mimetype: "image/gif", url_private: "https://files.slack.com/b.gif", url_private_download: "https://files.slack.com/b.gif" },
          { name: "modern.webp", mimetype: "image/webp", url_private: "https://files.slack.com/c.webp", url_private_download: "https://files.slack.com/c.webp" },
        ],
      },
    ];

    const client = mockClient(messages);
    const result = await fetchThread(client, "C123", "1700000000.000001");

    expect(result.images).toHaveLength(3);
    expect(result.images[0].mimeType).toBe("image/jpeg");
    expect(result.images[1].mimeType).toBe("image/gif");
    expect(result.images[2].mimeType).toBe("image/webp");
  });

  it("falls back to url_private when url_private_download is missing", async () => {
    const imageBytes = new Uint8Array([1, 2, 3]);
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(imageBytes.buffer),
    } as any);

    const messages = [
      {
        user: "U1",
        ts: "1700000000.000001",
        text: "no download url",
        files: [
          { name: "img.png", mimetype: "image/png", url_private: "https://files.slack.com/fallback.png" },
        ],
      },
    ];

    const client = mockClient(messages);
    await fetchThread(client, "C123", "1700000000.000001");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://files.slack.com/fallback.png",
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("skips images when fetch fails (non-ok response)", async () => {
    mockFetch.mockResolvedValue({ ok: false } as any);

    const messages = [
      {
        user: "U1",
        ts: "1700000000.000001",
        text: "broken image",
        files: [
          { name: "broken.png", mimetype: "image/png", url_private: "https://files.slack.com/broken.png", url_private_download: "https://files.slack.com/broken.png" },
        ],
      },
    ];

    const client = mockClient(messages);
    const result = await fetchThread(client, "C123", "1700000000.000001");

    expect(result.images).toHaveLength(0);
    expect(result.content).not.toContain("[Attached image:");
  });

  it("skips images when fetch throws an error", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));

    const messages = [
      {
        user: "U1",
        ts: "1700000000.000001",
        text: "network issue",
        files: [
          { name: "fail.png", mimetype: "image/png", url_private: "https://files.slack.com/fail.png", url_private_download: "https://files.slack.com/fail.png" },
        ],
      },
    ];

    const client = mockClient(messages);
    const result = await fetchThread(client, "C123", "1700000000.000001");

    expect(result.images).toHaveLength(0);
  });

  it("returns empty images array when no files are attached", async () => {
    const messages = [
      { user: "U1", ts: "1700000000.000001", text: "just text" },
    ];

    const client = mockClient(messages);
    const result = await fetchThread(client, "C123", "1700000000.000001");

    expect(result.images).toHaveLength(0);
    expect(result.content).toContain("just text");
  });

  it("handles mixed text and image files in the same message", async () => {
    const imageBytes = new Uint8Array([10, 20, 30]);

    // First call returns text file, second returns image
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve("file contents here"),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(imageBytes.buffer),
      } as any);

    const messages = [
      {
        user: "U1",
        ts: "1700000000.000001",
        text: "mixed files",
        files: [
          { name: "notes.txt", mimetype: "text/plain", url_private_download: "https://files.slack.com/notes.txt" },
          { name: "diagram.png", mimetype: "image/png", url_private: "https://files.slack.com/diagram.png", url_private_download: "https://files.slack.com/diagram.png" },
        ],
      },
    ];

    const client = mockClient(messages);
    const result = await fetchThread(client, "C123", "1700000000.000001");

    expect(result.content).toContain("[Attached file: notes.txt]");
    expect(result.content).toContain("file contents here");
    expect(result.content).toContain("[Attached image: diagram.png]");
    expect(result.images).toHaveLength(1);
    expect(result.images[0].mimeType).toBe("image/png");
  });

  it("collects images from multiple messages in the thread", async () => {
    const imageBytes = new Uint8Array([42]);
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(imageBytes.buffer),
    } as any);

    const messages = [
      {
        user: "U1",
        ts: "1700000000.000001",
        text: "first message",
        files: [{ name: "img1.png", mimetype: "image/png", url_private: "https://files.slack.com/1.png", url_private_download: "https://files.slack.com/1.png" }],
      },
      {
        user: "U2",
        ts: "1700000000.000002",
        text: "second message",
        files: [{ name: "img2.jpeg", mimetype: "image/jpeg", url_private: "https://files.slack.com/2.jpg", url_private_download: "https://files.slack.com/2.jpg" }],
      },
    ];

    const client = mockClient(messages);
    const result = await fetchThread(client, "C123", "1700000000.000001");

    expect(result.images).toHaveLength(2);
    expect(result.images[0].mimeType).toBe("image/png");
    expect(result.images[1].mimeType).toBe("image/jpeg");
  });

  it("ignores non-image, non-text files (e.g. PDF)", async () => {
    const messages = [
      {
        user: "U1",
        ts: "1700000000.000001",
        text: "pdf file",
        files: [
          { name: "report.pdf", mimetype: "application/pdf", url_private: "https://files.slack.com/report.pdf", url_private_download: "https://files.slack.com/report.pdf" },
        ],
      },
    ];

    const client = mockClient(messages);
    const result = await fetchThread(client, "C123", "1700000000.000001");

    expect(result.images).toHaveLength(0);
    expect(result.content).not.toContain("[Attached image:");
    expect(result.content).not.toContain("[Attached file:");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("uses default name 'image' when file.name is missing", async () => {
    const imageBytes = new Uint8Array([1]);
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(imageBytes.buffer),
    } as any);

    const messages = [
      {
        user: "U1",
        ts: "1700000000.000001",
        text: "unnamed",
        files: [
          { mimetype: "image/png", url_private: "https://files.slack.com/unnamed.png", url_private_download: "https://files.slack.com/unnamed.png" },
        ],
      },
    ];

    const client = mockClient(messages);
    const result = await fetchThread(client, "C123", "1700000000.000001");

    expect(result.content).toContain("[Attached image: image]");
  });

  it("returns content as string and images as array (return type contract)", async () => {
    const messages = [
      { user: "U1", ts: "1700000000.000001", text: "hello" },
    ];

    const client = mockClient(messages);
    const result = await fetchThread(client, "C123", "1700000000.000001");

    expect(typeof result.content).toBe("string");
    expect(Array.isArray(result.images)).toBe(true);
  });
});
