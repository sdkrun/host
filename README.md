# sdk.run host

A NativeScript app for iOS simulators that evaluates JavaScript snippets in-process against the live UIKit and Foundation of the OS it runs on. It is the execution half of the [sdk.run](https://sdk.run) simulator sandbox; the Mac side is [`@sdkrun/agent-runtime`](https://www.npmjs.com/package/@sdkrun/agent-runtime), which boots a simulator, installs this app, and brokers snippets to it.

```sh
npx -y @sdkrun/agent-runtime ios          # boots a simulator, installs the host, serves 127.0.0.1:7331
curl -s -X POST 127.0.0.1:7331/run -H 'content-type: application/json' \
  -d '{"code":"return UIDevice.currentDevice.systemVersion"}'
```

## Protocol

The app long-polls the broker on the Mac (default `http://127.0.0.1:7331`, override with the launch argument `--sdkrun-port <n>`):

- `GET /host/next?hostVersion=…&os=…&model=…` → `200 {id, code, reset?}` or `204`
- `POST /host/result` → `{id, ok, result | error, logs, ms}`

A snippet is the body of an async function; `return` hands a value back. In scope: `page` and `stage` (a NativeScript `Page` / `StackLayout` for ad-hoc views), `rootVC` (the window's root `UIViewController`), `frame`. Results are serialized: ObjC objects by `.description`, `NSArray`/`NSDictionary` walked to depth 3, `console.log` captured. `reset: true` dismisses whatever a previous snippet presented and clears the stage before running.

## Build

```sh
npm ci && npm i -g nativescript
ns build ios --release            # platforms/ios/build/Release-iphonesimulator/sdkrunhost.app
```

Tags `v*` build and attach `sdkrunhost-ios.zip` to a GitHub Release; the runtime downloads the release matching its pinned host version.

## Hosted sessions

`.github/workflows/session.yml` runs a disposable sandbox on a GitHub macOS runner for the [sdk.run/sandbox](https://sdk.run/sandbox) page: it boots a simulator, installs this host, runs `@sdkrun/agent-runtime ios` and SimDeck, exposes both through Cloudflare quick tunnels, and registers the URLs with sdk.run (`register_url`, bearer `SDKRUN_SESSION_SECRET`). Sessions last `keepalive_seconds` (default 20 minutes). Optional repo secrets `CF_TURN_KEY_ID` / `CF_TURN_API_TOKEN` (a Cloudflare Realtime TURN key) let the WebRTC stream cross NAT; without them the page falls back to screenshots.

## Security

Snippets execute with the simulator app's privileges on the simulator, brokered only over loopback. This is a local development tool for code you or your agent wrote; do not expose the broker to untrusted callers.

Apache-2.0.
