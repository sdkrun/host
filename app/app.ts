import {
  Application,
  Frame,
  GridLayout,
  Http,
  Label,
  Page,
  StackLayout,
  Utils,
} from '@nativescript/core';

/**
 * sdk.run host — a NativeScript app that evaluates JavaScript snippets
 * in-process against the live UIKit/Foundation of the simulator it runs on.
 *
 * Protocol (broker on the Mac, default http://127.0.0.1:7331; override with
 * the launch argument `--sdkrun-port <n>`):
 *   GET  /host/next?…info   long-poll for a job → 200 {id, code, reset?} | 204
 *   POST /host/result       {id, ok, result|error, logs, ms}
 *
 * The snippet is the body of an async function: `return` hands a value back.
 * In scope: page, stage (a StackLayout for ad-hoc views), rootVC, frame.
 */

const HOST_VERSION = '0.1.0';

function portFromArgs(): number {
  const args = NSProcessInfo.processInfo.arguments;
  for (let i = 0; i < args.count - 1; i++) {
    if (String(args.objectAtIndex(i)) === '--sdkrun-port') {
      const n = parseInt(String(args.objectAtIndex(i + 1)), 10);
      if (n > 0) return n;
    }
  }
  return 7331;
}

const SERVER = `http://127.0.0.1:${portFromArgs()}`;

let status: Label;
let stage: StackLayout;
let page: Page;

function serialize(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined) return null;
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean') return v;
  if (t === 'function')
    return `[function ${(v as Function).name || 'anonymous'}]`;
  if (depth > 3) return String(v);
  if (Array.isArray(v)) return v.map((x) => serialize(x, depth + 1));
  const anyV = v as any;
  if (anyV instanceof NSObject) {
    if (anyV instanceof NSString) return String(anyV);
    if (anyV instanceof NSNumber) return Number(anyV);
    if (anyV instanceof NSArray) {
      const out: unknown[] = [];
      for (let i = 0; i < Math.min(anyV.count, 50); i++)
        out.push(serialize(anyV.objectAtIndex(i), depth + 1));
      return out;
    }
    if (anyV instanceof NSDictionary) {
      const out: Record<string, unknown> = {};
      const keys = anyV.allKeys;
      for (let i = 0; i < Math.min(keys.count, 50); i++) {
        const k = keys.objectAtIndex(i);
        out[String(k)] = serialize(anyV.objectForKey(k), depth + 1);
      }
      return out;
    }
    return String(anyV.description);
  }
  if (t === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(anyV).slice(0, 50))
      out[k] = serialize(anyV[k], depth + 1);
    return out;
  }
  return String(v);
}

function rootViewController(): UIViewController | null {
  const win = UIApplication.sharedApplication.keyWindow;
  return win ? win.rootViewController : null;
}

/** Dismiss anything a previous snippet presented and clear the stage. */
function reset() {
  const root = rootViewController();
  if (root?.presentedViewController)
    root.dismissViewControllerAnimatedCompletion(false, null);
  stage.removeChildren();
}

async function runSnippet(code: string) {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(
      args
        .map((a) =>
          typeof a === 'string' ? a : JSON.stringify(serialize(a))
        )
        .join(' ')
    );
    origLog.apply(console, args as []);
  };
  const t0 = Date.now();
  try {
    const rootVC = rootViewController();
    const fn = new Function(
      'page',
      'stage',
      'rootVC',
      'frame',
      `return (async () => {\n${code}\n})();`
    );
    const value = await fn(page, stage, rootVC, Frame.topmost());
    return { ok: true, result: serialize(value), logs, ms: Date.now() - t0 };
  } catch (e: any) {
    return {
      ok: false,
      error: String(e?.message ?? e),
      stack: String(e?.stack ?? '').split('\n').slice(0, 6).join('\n'),
      logs,
      ms: Date.now() - t0,
    };
  } finally {
    console.log = origLog;
  }
}

async function post(path: string, body: unknown) {
  await Http.request({
    url: SERVER + path,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    content: JSON.stringify(body),
    timeout: 10000,
  });
}

function hostInfo(): string {
  const d = UIDevice.currentDevice;
  const s = UIScreen.mainScreen;
  const q = {
    hostVersion: HOST_VERSION,
    platform: 'ios',
    os: `${d.systemName} ${d.systemVersion}`,
    osVersion: d.systemVersion,
    model: d.model,
    name: d.name,
    screen: `${s.bounds.size.width}x${s.bounds.size.height}@${s.scale}`,
  };
  return Object.entries(q)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
}

async function pollLoop() {
  const info = hostInfo();
  let backoff = 250;
  for (;;) {
    try {
      const res = await Http.request({
        url: `${SERVER}/host/next?${info}`,
        method: 'GET',
        timeout: 30000,
      });
      if (res.statusCode === 200) {
        const job = res.content.toJSON() as {
          id: string;
          code: string;
          reset?: boolean;
        };
        setStatus(`running ${job.id}`);
        if (job.reset) reset();
        const out = await runSnippet(job.code);
        await post('/host/result', { id: job.id, ...out });
        setStatus(out.ok ? `ok · ${out.ms}ms` : `error · ${out.error}`);
      } else {
        setStatus('connected · idle');
      }
      backoff = 250;
    } catch {
      setStatus(`waiting for broker on ${SERVER}`);
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 4000);
    }
  }
}

function setStatus(s: string) {
  if (status) status.text = `sdk.run host · ${s}`;
}

function createPage(): Page {
  page = new Page();
  page.actionBarHidden = true;
  const grid = new GridLayout();
  grid.rows = 'auto, *';
  grid.backgroundColor = '#FAF7F0';

  status = new Label();
  status.text = 'sdk.run host · starting';
  status.fontSize = 12;
  status.color = '#6b6b63' as any;
  status.padding = '54 16 8 16';
  status.textWrap = true;
  GridLayout.setRow(status, 0);
  grid.addChild(status);

  stage = new StackLayout();
  stage.padding = 16;
  GridLayout.setRow(stage, 1);
  grid.addChild(stage);

  page.content = grid;
  page.on('loaded', () => {
    setStatus('connecting');
    Utils.setTimeout(() => void pollLoop(), 300);
  });
  return page;
}

Application.run({ create: createPage });
