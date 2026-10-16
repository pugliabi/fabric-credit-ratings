import Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDrafter, failureDetails, mentionsMath, promptFor, type DraftInput } from './draft-why.ts';

const clients = vi.hoisted(() => [] as { options: unknown; client: unknown }[]);

vi.mock(import('@anthropic-ai/sdk'), async (importOriginal) => {
  const real = await importOriginal();
  class Recording extends real.default {
    constructor(options?: ConstructorParameters<typeof real.default>[0]) {
      super(options);
      clients.push({ options, client: this });
    }
  }
  return { ...real, default: Recording };
});

// The client takes the global fetch when it's built, so no test here can reach Anthropic, even one that forgets to
// stub create.
const offline = vi.hoisted(() => () => Promise.reject(new Error('Unit tests make no network calls.')));
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(offline));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const input: DraftInput = {
  artifact: { id: 'notebook', name: 'Notebook', workload: 'data-engineering', status: 'ga' },
  workload: { id: 'data-engineering', name: 'Data Engineering', shortName: 'Data Eng', blurb: 'Notebooks and Spark' },
  roundLabel: 'Q4 2026',
  scores: { capability: 6, ux: 5, cost: 4 },
  raters: 2,
};

describe('mentionsMath', () => {
  it('flags grades, totals, and sums', () => {
    expect(mentionsMath('Rated AA+ this time')).toBe(true);
    expect(mentionsMath('scored 18 out of 21')).toBe(true);
    expect(mentionsMath('5 + 6 + 7')).toBe(true);
    expect(mentionsMath('A dependable workhorse with rough edges.')).toBe(false);
  });

  it('flags single-letter grades with a sign, and the "6 of 7" form the prompt uses', () => {
    expect(mentionsMath('It earns an A- this quarter.')).toBe(true);
    expect(mentionsMath('An A+ effort.')).toBe(true);
    expect(mentionsMath('Rated B+')).toBe(true);
    expect(mentionsMath('It slipped to B-.')).toBe(true);
    expect(mentionsMath('An AA-rated tool.')).toBe(true);
    expect(mentionsMath('capability 6 of 7')).toBe(true);
    expect(mentionsMath('cost is 3 OF 7 now')).toBe(true);
    expect(mentionsMath('a total of 15/21')).toBe(true);
    expect(mentionsMath('Six out of seven raters agree.')).toBe(true);
  });

  it('leaves words that only contain grade letters alone', () => {
    expect(mentionsMath('ACCESS and CCA')).toBe(false);
    expect(mentionsMath('A B-tree index and an A-list feature.')).toBe(false);
    expect(mentionsMath('One of 7 workloads.')).toBe(false);
  });

  it('flags a score over 7 or 21 written with a slash, decimals included, but not 24/7', () => {
    const scores = ['capability 6/7', 'rated 6 / 7', 'a total of 15/21', 'a perfect 21/21'];
    for (const text of [...scores, 'about 5.67/7', 'a 17.0/21 total', 'a clean 6.0/7', 'roughly 16.67/21']) {
      expect(mentionsMath(text)).toBe(true);
    }
    expect(mentionsMath('Support is 24/7.')).toBe(false);
    expect(mentionsMath('Support is 24 / 7.')).toBe(false);
  });
});

describe('promptFor', () => {
  it('names the workload and forbids the math', () => {
    const prompt = promptFor(input);
    expect(prompt).toContain('Workload: Data Engineering (Notebooks and Spark)');
    expect(prompt).toContain('average of 2 raters');
    expect(prompt).toContain('Never mention scores');
  });

  it('names the workload id, with no empty brackets, when the workload row is missing', () => {
    const { workload: _, ...withoutWorkload } = input;
    expect(promptFor(withoutWorkload)).toContain('Workload: data-engineering\n');
  });
});

describe('createDrafter', () => {
  const settings = { apiKey: 'k', workspaceId: '', model: '' };

  /** The client the drafter built, with its messages.create stubbed. */
  function stubbedCreate() {
    const client = clients.at(-1)?.client as Anthropic | undefined;
    if (!client) throw new Error('createDrafter built no client.');
    return vi.spyOn(client.messages, 'create');
  }

  const reply = (text: string) => ({ content: [{ type: 'text', text }] }) as never;

  beforeEach(() => {
    clients.length = 0;
  });

  it('is off without an API key', () => {
    expect(createDrafter({ apiKey: '', workspaceId: '', model: '' })).toBeUndefined();
    expect(clients).toEqual([]);
  });

  it('gives up on a slow provider well inside the 230 s HTTP limit', () => {
    createDrafter({ ...settings, workspaceId: 'ws' });
    expect(clients).toHaveLength(1);
    expect(clients[0]?.options).toMatchObject({
      apiKey: 'k',
      // So the client can't pick up ANTHROPIC_AUTH_TOKEN from the environment and send it as well.
      authToken: null,
      timeout: 40_000,
      maxRetries: 1,
      defaultHeaders: { 'anthropic-workspace-id': 'ws' },
    });
  });

  it('asks once more when the first draft leaks the math', async () => {
    const draft = createDrafter(settings);
    const create = stubbedCreate()
      .mockResolvedValueOnce(reply('Solid, at 6 of 7 for capability.'))
      .mockResolvedValueOnce(reply('Solid and complete.'));

    expect(await draft?.(input)).toBe('Solid and complete.');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('gives up when the rewrite leaks the math too', async () => {
    const draft = createDrafter(settings);
    const create = stubbedCreate().mockResolvedValue(reply('Rated AA+.'));

    await expect(draft?.(input)).rejects.toThrow('The model kept mentioning scores or grades. Write this one by hand.');
    expect(create).toHaveBeenCalledTimes(2);
    const retry = JSON.stringify(create.mock.calls[1]?.[0]);
    expect(retry).toContain('Rewrite it without any of those.');
    expect(retry).toContain('Rated AA+.');
  });

  describe("the caller's deadline", () => {
    const timedOut = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');

    it('goes to every call, so it also cuts short the retry waits inside the SDK', async () => {
      const deadline = new AbortController().signal;
      const draft = createDrafter(settings);
      const create = stubbedCreate()
        .mockResolvedValueOnce(reply('Solid, at 6 of 7 for capability.'))
        .mockResolvedValueOnce(reply('Solid and complete.'));

      expect(await draft?.(input, deadline)).toBe('Solid and complete.');
      expect(create).toHaveBeenNthCalledWith(1, expect.anything(), { signal: deadline });
      expect(create).toHaveBeenNthCalledWith(2, expect.anything(), { signal: deadline });
    });

    it('ends a call that never answers with the timeout message', async () => {
      const deadline = new AbortController();
      const draft = createDrafter(settings);
      // Like the SDK: nothing comes back until the signal aborts the request.
      const create = stubbedCreate().mockImplementation(
        (_body, options) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => reject(new Anthropic.APIUserAbortError()));
          }) as never,
      );

      const drafting = draft?.(input, deadline.signal);
      await Promise.resolve();
      deadline.abort(timedOut());

      await expect(drafting).rejects.toThrow('Anthropic did not answer in time. Try again.');
      expect(create).toHaveBeenCalledTimes(1);
    });

    it('does not start the second attempt once it has passed', async () => {
      const deadline = new AbortController();
      const draft = createDrafter(settings);
      const create = stubbedCreate().mockImplementation(() => {
        deadline.abort(timedOut());
        return Promise.resolve(reply('Solid, at 6 of 7 for capability.')) as never;
      });

      await expect(draft?.(input, deadline.signal)).rejects.toThrow('Anthropic did not answer in time. Try again.');
      expect(create).toHaveBeenCalledTimes(1);
    });
  });

  it.each([
    [
      'a timeout',
      new Anthropic.APIConnectionTimeoutError(),
      'Anthropic did not answer in time. Try again.',
    ],
    ['an aborted request', new Anthropic.APIUserAbortError(), 'Anthropic did not answer in time. Try again.'],
    [
      'a timed-out signal',
      new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
      'Anthropic did not answer in time. Try again.',
    ],
    [
      'an aborted signal',
      new DOMException('This operation was aborted', 'AbortError'),
      'Anthropic did not answer in time. Try again.',
    ],
    [
      'an unknown model',
      new Anthropic.NotFoundError(404, { type: 'error', error: { type: 'not_found_error' } }, undefined, new Headers()),
      "ANTHROPIC_MODEL names a model this key can't use. Check the setting in the Function App.",
    ],
    [
      'a rejected key',
      new Anthropic.AuthenticationError(401, { type: 'error' }, undefined, new Headers()),
      'Anthropic rejected ANTHROPIC_API_KEY. Check the key in the Function App settings.',
    ],
    [
      'a key with no workspace',
      new Anthropic.BadRequestError(
        400,
        { error: { message: 'anthropic-workspace-id is required' } },
        undefined,
        new Headers(),
      ),
      'This Anthropic key is not scoped to a workspace.',
    ],
    [
      'a rate limit',
      new Anthropic.RateLimitError(429, { type: 'error' }, undefined, new Headers()),
      "Anthropic's rate limit was reached. Wait a minute, then try again.",
    ],
    [
      'an overload',
      new Anthropic.InternalServerError(529, { type: 'error' }, undefined, new Headers()),
      'Anthropic is overloaded right now. Try again in a minute.',
    ],
    [
      'an overloaded error with another status',
      new Anthropic.InternalServerError(500, { type: 'error' }, undefined, new Headers(), 'overloaded_error'),
      'Anthropic is overloaded right now. Try again in a minute.',
    ],
  ])('explains %s, keeping the provider error as the cause', async (_, error, message) => {
    const draft = createDrafter(settings);
    stubbedCreate().mockRejectedValueOnce(error);
    const failure = await draft?.(input).catch((caught: unknown) => caught);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(message);
    expect((failure as Error).cause).toBe(error);
  });

  describe('a key a request header cannot carry', () => {
    const refused =
      "ANTHROPIC_API_KEY has a line break or another character a request header can't carry. " +
      'Paste the key again in the Function App settings.';

    it.each([
      ['an interior line break', 'sk-ant-unit\ntest-secret'],
      ['a NUL', 'sk-ant-unit\u0000test-secret'],
      ['an interior space', 'sk-ant-unit test-secret'],
    ])('is refused for %s before any client exists, and nothing quotes it', async (_, apiKey) => {
      const keySettings = { ...settings, apiKey };
      const draft = createDrafter(keySettings);

      const failure = await draft?.(input).catch((caught: unknown) => caught);
      expect((failure as Error).message).toBe(refused);
      expect(clients).toEqual([]);
      const logged = JSON.stringify(failureDetails(failure, keySettings));
      for (const part of ['sk-ant-unit', 'test-secret']) {
        expect((failure as Error).message).not.toContain(part);
        expect(logged).not.toContain(part);
      }
    });

    it('is taken once its outer whitespace is trimmed, if that leaves nothing a header refuses', () => {
      createDrafter({ ...settings, apiKey: '  sk-ant-unit-ok \n' });
      expect(clients[0]?.options).toMatchObject({ apiKey: 'sk-ant-unit-ok' });
    });
  });

  it('redacts the key, as set and trimmed, from error text that quotes it, in the message and the log', async () => {
    const keySettings = { ...settings, apiKey: ' sk-ant-unit-test-secret ' };
    const draft = createDrafter(keySettings);
    const quoting = new TypeError('Headers.append: "sk-ant-unit-test-secret" is an invalid header value.');
    stubbedCreate().mockRejectedValueOnce(quoting);

    const failure = await draft?.(input).catch((caught: unknown) => caught);
    expect((failure as Error).message).toBe('Headers.append: "[redacted]" is an invalid header value.');
    const logged = JSON.stringify(failureDetails(failure, keySettings));
    expect(logged).not.toContain('sk-ant-unit-test-secret');
    expect(logged).toContain('[redacted]');
  });

  it('redacts the key from a provider body that quotes it', async () => {
    const keySettings = { ...settings, apiKey: 'sk-ant-unit-test-secret' };
    const draft = createDrafter(keySettings);
    const body = { error: { message: 'invalid x-api-key sk-ant-unit-test-secret' } };
    stubbedCreate().mockRejectedValueOnce(new Anthropic.BadRequestError(400, body, undefined, new Headers()));

    const failure = await draft?.(input).catch((caught: unknown) => caught);
    const redacted = JSON.stringify(body).replace('sk-ant-unit-test-secret', '[redacted]');
    expect((failure as Error).message).toBe(`400 ${redacted}`);
    expect(JSON.stringify(failureDetails(failure, keySettings))).not.toContain('sk-ant-unit-test-secret');
  });

  it('passes the text of an error it has no message for, still keeping that error as the cause', async () => {
    const fetchFailed = new TypeError('fetch failed');
    const provider = new Anthropic.APIConnectionError({ message: 'Connection error.', cause: fetchFailed });
    const draft = createDrafter(settings);
    stubbedCreate().mockRejectedValueOnce(provider);

    const failure = await draft?.(input).catch((caught: unknown) => caught);
    expect((failure as Error).message).toBe('Connection error.');
    expect((failure as Error).cause).toBe(provider);
  });
});

describe('failureDetails', () => {
  const settings = { apiKey: 'sk-ant-unit-test-secret', workspaceId: '', model: 'claude-test' };

  it("logs the provider's status, request id, and error type, and the model asked, from the cause", () => {
    const body = { type: 'error', error: { type: 'rate_limit_error', message: 'Too many requests.' } };
    const provider = new Anthropic.RateLimitError(
      429,
      body,
      undefined,
      new Headers({ 'request-id': 'req_123' }),
      'rate_limit_error',
    );
    const failure = new Error("Anthropic's rate limit was reached.", { cause: provider });

    expect(failureDetails(failure, settings)).toEqual({
      model: 'claude-test',
      status: 429,
      requestId: 'req_123',
      type: 'rate_limit_error',
      error: `RateLimitError: 429 ${JSON.stringify(body)}`,
    });
  });

  it('logs the chain behind a network failure, with the socket code, and no status', () => {
    const socket = Object.assign(new Error('getaddrinfo ENOTFOUND api.anthropic.com'), { code: 'ENOTFOUND' });
    const fetchFailed = new TypeError('fetch failed', { cause: socket });
    const provider = new Anthropic.APIConnectionError({ message: 'Connection error.', cause: fetchFailed });

    expect(failureDetails(new Error('Connection error.', { cause: provider }), settings)).toEqual({
      model: 'claude-test',
      error:
        'APIConnectionError: Connection error. <- TypeError: fetch failed ' +
        '<- Error: getaddrinfo ENOTFOUND api.anthropic.com (ENOTFOUND)',
    });
  });

  it('names the default model and the message for a failure the provider did not send', () => {
    const failure = new Error('The model kept mentioning scores or grades. Write this one by hand.');
    expect(failureDetails(failure, { ...settings, model: '' })).toEqual({
      model: 'claude-sonnet-5-5',
      error: 'Error: The model kept mentioning scores or grades. Write this one by hand.',
    });
  });

  it('carries neither the key nor the prompt', () => {
    const provider = new Anthropic.NotFoundError(404, { type: 'error' }, undefined, new Headers());
    const logged = JSON.stringify(failureDetails(new Error('Not found.', { cause: provider }), settings));
    expect(logged).not.toContain(settings.apiKey);
    expect(logged).not.toContain('why this rating');
  });
});
