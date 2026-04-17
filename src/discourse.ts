export interface DiscourseUsers {
  submitter: string;
  voxel: string;
  canvas: string;
  loop: string;
  signal: string;
  oracle: string;
}

export interface DiscourseConfig {
  url: string;
  apiKey: string;
  categoryId: number;
  users: DiscourseUsers;
}

export interface CreateTopicOpts {
  title: string;
  body: string;
  categoryId: number;
  username: string;
}

export interface CreateTopicResult {
  topicId: number;
  topicSlug: string;
  topicUrl: string;
  postId: number;
}

export interface ReplyOpts {
  topicId: number;
  body: string;
  username: string;
}

export interface ReplyResult {
  postId: number;
  postUrl: string;
}

export interface EditOpts {
  postId: number;
  body: string;
  username: string;
  editReason?: string;
}

interface DiscoursePostResponse {
  id: number;
  topic_id: number;
  topic_slug: string;
  post_number: number;
}

export class DiscourseClient {
  private baseUrl: string;

  constructor(baseUrl: string, private apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async createTopic(opts: CreateTopicOpts): Promise<CreateTopicResult> {
    const res = await this.request<DiscoursePostResponse>("/posts.json", "POST", opts.username, {
      title: opts.title,
      raw: opts.body,
      category: opts.categoryId,
    });
    return {
      topicId: res.topic_id,
      topicSlug: res.topic_slug,
      topicUrl: `${this.baseUrl}/t/${res.topic_slug}/${res.topic_id}`,
      postId: res.id,
    };
  }

  async reply(opts: ReplyOpts): Promise<ReplyResult> {
    const res = await this.request<DiscoursePostResponse>("/posts.json", "POST", opts.username, {
      topic_id: opts.topicId,
      raw: opts.body,
    });
    return {
      postId: res.id,
      postUrl: `${this.baseUrl}/t/${res.topic_slug}/${res.topic_id}/${res.post_number}`,
    };
  }

  async editPost(opts: EditOpts): Promise<void> {
    await this.request<unknown>(`/posts/${opts.postId}.json`, "PUT", opts.username, {
      post: {
        raw: opts.body,
        edit_reason: opts.editReason ?? "Refined via grants agents",
      },
    });
  }

  postUrl(postId: number): string {
    return `${this.baseUrl}/p/${postId}`;
  }

  private async request<T>(
    path: string,
    method: "POST" | "PUT" | "GET",
    username: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Api-Key": this.apiKey,
        "Api-Username": username,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `Discourse ${method} ${path} as ${username} failed: ${res.status} ${res.statusText}` +
          (errText ? `\n${errText.slice(0, 500)}` : ""),
      );
    }
    const json: unknown = await res.json();
    return json as T;
  }
}
