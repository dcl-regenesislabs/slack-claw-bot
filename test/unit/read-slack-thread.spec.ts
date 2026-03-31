import { jest } from "@jest/globals";
import { parseSlackUrl, createSlackTools } from "../../src/tools/read-slack-thread.js";

describe("parseSlackUrl", () => {
  it("parses a standard Slack permalink", () => {
    const result = parseSlackUrl(
      "https://decentraland.slack.com/archives/C0123ABCDEF/p1234567890123456",
    );
    expect(result).toEqual({
      channel: "C0123ABCDEF",
      threadTs: "1234567890.123456",
    });
  });

  it("parses a URL with extra path segments or query params", () => {
    const result = parseSlackUrl(
      "https://myworkspace.slack.com/archives/C999ABC/p1700000000654321?thread_ts=foo",
    );
    expect(result).toEqual({
      channel: "C999ABC",
      threadTs: "1700000000.654321",
    });
  });

  it("returns null for non-Slack URLs", () => {
    expect(parseSlackUrl("https://github.com/org/repo/pull/1")).toBeNull();
  });

  it("returns null for malformed Slack URLs", () => {
    expect(
      parseSlackUrl("https://decentraland.slack.com/archives/C123"),
    ).toBeNull();
  });
});

describe("createSlackTools", () => {
  function mockClient(replies: any[] = [], error?: string) {
    const conversations = {
      replies: error
        ? jest.fn().mockRejectedValue({ data: { error } })
        : jest.fn().mockResolvedValue({ messages: replies }),
    };
    const users = {
      info: jest.fn().mockImplementation(({ user }: { user: string }) =>
        Promise.resolve({ user: { real_name: `User_${user}`, name: user } }),
      ),
    };
    return { conversations, users } as any;
  }

  it("returns one tool named read_slack_thread", () => {
    const tools = createSlackTools(mockClient());
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("read_slack_thread");
  });

  it("fetches a thread by URL", async () => {
    const messages = [
      { user: "U1", ts: "1700000000.000001", text: "hello" },
      { user: "U2", ts: "1700000000.000002", text: "world" },
    ];
    const client = mockClient(messages);
    const [tool] = createSlackTools(client);

    const result = await tool.execute(
      "call-1",
      { url: "https://test.slack.com/archives/C123ABC/p1700000000000001" },
      undefined,
      undefined,
      {} as any,
    );

    expect(client.conversations.replies).toHaveBeenCalledWith({
      channel: "C123ABC",
      ts: "1700000000.000001",
      limit: 200,
    });
    expect(result.content[0].type).toBe("text");
    expect((result.content[0] as any).text).toContain("hello");
    expect((result.content[0] as any).text).toContain("world");
  });

  it("fetches a thread by channel + thread_ts", async () => {
    const client = mockClient([
      { user: "U1", ts: "1700000000.000001", text: "direct" },
    ]);
    const [tool] = createSlackTools(client);

    const result = await tool.execute(
      "call-2",
      { channel: "C999", thread_ts: "1700000000.000001" },
      undefined,
      undefined,
      {} as any,
    );

    expect(client.conversations.replies).toHaveBeenCalledWith({
      channel: "C999",
      ts: "1700000000.000001",
      limit: 200,
    });
    expect((result.content[0] as any).text).toContain("direct");
  });

  it("returns error for invalid URL", async () => {
    const [tool] = createSlackTools(mockClient());

    const result = await tool.execute(
      "call-3",
      { url: "https://not-slack.com/foo" },
      undefined,
      undefined,
      {} as any,
    );

    expect((result.content[0] as any).text).toMatch(/Could not parse/);
  });

  it("returns error when neither url nor channel+thread_ts provided", async () => {
    const [tool] = createSlackTools(mockClient());

    const result = await tool.execute(
      "call-4",
      {},
      undefined,
      undefined,
      {} as any,
    );

    expect((result.content[0] as any).text).toMatch(/Provide either/);
  });

  it("respects the limit parameter — shows last N messages", async () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      user: "U1",
      ts: `1700000000.00000${i}`,
      text: `msg-${i}`,
    }));
    const client = mockClient(messages);
    const [tool] = createSlackTools(client);

    const result = await tool.execute(
      "call-5",
      { channel: "C1", thread_ts: "1700000000.000000", limit: 3 },
      undefined,
      undefined,
      {} as any,
    );

    const text = (result.content[0] as any).text as string;
    expect(text).toContain("Showing last 3 of 10 messages");
    expect(text).toContain("msg-7");
    expect(text).toContain("msg-8");
    expect(text).toContain("msg-9");
    expect(text).not.toContain("msg-6");
  });

  it("handles not_in_channel error gracefully", async () => {
    const client = mockClient([], "not_in_channel");
    const [tool] = createSlackTools(client);

    const result = await tool.execute(
      "call-6",
      { channel: "C1", thread_ts: "1700000000.000000" },
      undefined,
      undefined,
      {} as any,
    );

    expect((result.content[0] as any).text).toMatch(/not a member/);
  });

  it("handles channel_not_found error gracefully", async () => {
    const client = mockClient([], "channel_not_found");
    const [tool] = createSlackTools(client);

    const result = await tool.execute(
      "call-7",
      { channel: "CXXX", thread_ts: "1700000000.000000" },
      undefined,
      undefined,
      {} as any,
    );

    expect((result.content[0] as any).text).toMatch(/not found/i);
  });

  it("extracts content from attachments when text is empty (e.g. GitHub bot)", async () => {
    const messages = [
      {
        ts: "1700000000.000001",
        bot_id: "BGITHUB",
        bot_profile: { name: "GitHub" },
        text: "",
        attachments: [{ text: "PR #42 opened by user: fix typo", fallback: "PR opened" }],
      },
    ];
    const client = mockClient(messages);
    const [tool] = createSlackTools(client);

    const result = await tool.execute(
      "call-8",
      { channel: "C123", thread_ts: "1700000000.000001" },
      undefined,
      undefined,
      {} as any,
    );

    const text = (result.content[0] as any).text as string;
    expect(text).toContain("GitHub");
    expect(text).toContain("PR #42 opened by user: fix typo");
  });

  it("extracts content from blocks when text and attachments are absent", async () => {
    const messages = [
      {
        ts: "1700000000.000001",
        username: "DeployBot",
        text: "",
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Deployment complete" } }],
      },
    ];
    const client = mockClient(messages);
    const [tool] = createSlackTools(client);

    const result = await tool.execute(
      "call-9",
      { channel: "C123", thread_ts: "1700000000.000001" },
      undefined,
      undefined,
      {} as any,
    );

    const text = (result.content[0] as any).text as string;
    expect(text).toContain("DeployBot");
    expect(text).toContain("Deployment complete");
  });
});
