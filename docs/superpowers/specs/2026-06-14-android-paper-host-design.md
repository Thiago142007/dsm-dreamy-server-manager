# Dreamy Server Manager Android Paper Host Design

## Goal

Create an installable Android APK that can host one Paper 1.21.11 Minecraft server directly on an ARM64 mobile device. The server must continue running when the app is not visible and when the screen is off, subject to Android resource and process-management limits.

The first Android release targets Android 10 or newer and approximately ten concurrent players on sufficiently capable hardware. It is intended for personal, experimental, and small-group hosting rather than guaranteed 24/7 production uptime.

## Scope

The first APK provides:

- One locally hosted Paper server per Android device.
- Paper 1.21.11 download and installation.
- An embedded ARM64 Java 21 runtime.
- Start, graceful stop, forced stop, and restart controls.
- Live console output and command input.
- Basic server file browsing, editing, upload, import, and export.
- Editable `server.properties`.
- Configurable JVM memory limit with a conservative default.
- A persistent foreground-service notification while hosting.
- Operation while the activity is closed or the screen is off.
- Local-network access to the Minecraft port and management panel.

The first release does not promise public internet reachability, uninterrupted operation under thermal or memory pressure, multiple simultaneous servers, BungeeCord, plugin-store browsing, cowork accounts, or Google Play distribution.

## Architecture

The Android application is a separate client/runtime target inside the existing repository. It does not attempt to convert Electron directly to Android.

### Android UI

A Kotlin Android activity hosts the existing responsive DSM web interface in a WebView. Android-specific navigation and setup screens may be native where system APIs are required, such as file selection, notification permission, and battery-optimization guidance.

The web panel communicates only with a loopback HTTP API exposed by the Android application. It does not receive direct filesystem or process access.

### Local Management API

An embedded HTTP server bound to `127.0.0.1` serves the bundled frontend and a focused subset of the existing DSM API. The API owns server configuration, file operations, downloads, process control, and console state.

Only the management UI is loopback-only by default. A later setting may expose it to the LAN with authentication, but this is outside the first APK scope. The Minecraft server itself binds to the configured game port, normally `25565`.

### Paper Runtime

The app bundles a Java 21 runtime built for Android ARM64 or an Android-compatible ARM64 JVM distribution whose license permits redistribution. The runtime is extracted into app-private storage on first use.

Paper runs inside a dedicated Android service process named `:paper`, isolated from the activity and management API process. A small native JNI launcher loads the Android-compatible JVM through `libjli.so` and calls `JLI_Launch`; it does not rely on executing an extracted desktop-style `java` binary. Standard input, output, and error are connected through pipes to the Android runtime manager. Console output is retained in a bounded buffer and written to a rotating application log.

The default JVM allocation is conservative and derived from available device memory. The initial selectable range is 1 GB to 4 GB, while preventing a configured maximum that would leave too little memory for Android and the app. The launch command uses `nogui` and minimal, documented JVM flags.

### Background Hosting

Hosting is owned by a started foreground service, not by the activity. Starting Paper immediately promotes the service and displays an ongoing notification with status and stop controls.

While Paper is running, the service holds:

- A partial CPU wake lock so screen-off sleep does not suspend the server process.
- A high-performance Wi-Fi lock when Wi-Fi is active.
- A persistent notification required for visible long-running work.

The setup flow asks the user to allow notifications and explains how to set battery usage to unrestricted or exempt the app from optimization. These measures reduce interruption but cannot override low-memory kills, vendor firmware policies, thermal shutdown, device restart, or user force-stop.

The service performs a graceful `stop` command before termination whenever Android gives it a shutdown callback. After an unexpected process exit, the UI and notification show the failure. Automatic crash restart is disabled by default to avoid restart loops and world corruption.

## Storage

Server data lives under the application's private files directory. This avoids broad storage permissions and prevents other apps from modifying a live world.

Android's Storage Access Framework is used to:

- Import an existing DSM/Paper ZIP.
- Upload selected files into the server directory.
- Export a stopped server to a user-selected ZIP destination.

Path resolution rejects traversal outside the server root. Destructive operations and archive extraction validate canonical paths. Export and import require the server to be stopped to reduce corruption risk.

## Installation Flow

On first launch, the app:

1. Checks for a 64-bit ARM device, supported Android version, available RAM, and free storage.
2. Requests notification permission where required.
3. Explains battery-optimization and charger recommendations.
4. Extracts and verifies the embedded Java runtime.
5. Downloads the selected Paper 1.21.11 build from Paper's official API.
6. Writes `eula=true` only after explicit EULA acceptance in the app.
7. Creates initial server properties and starts the management panel.

Downloads use HTTPS, temporary files, and atomic rename after validation. Interrupted setup can resume without deleting a valid server directory.

## Networking

The Paper port defaults to `25565` and listens on available device interfaces. Players on the same Wi-Fi network connect using the phone's LAN address.

Internet access is not automatic. Carrier-grade NAT, mobile data policies, router NAT, and Android hotspot isolation can prevent incoming connections. Port forwarding, a VPN overlay, or a tunnel is a separate deployment concern.

The app displays current LAN addresses and clearly distinguishes local reachability from public reachability.

## Error Handling

The runtime reports actionable states: not installed, installing, offline, starting, running, stopping, crashed, and blocked.

Failures include a concise user message and a technical log entry. Important cases are unsupported CPU architecture, insufficient free storage, insufficient memory, Java extraction failure, Paper download failure, occupied port, child-process failure, and Android background restrictions.

Before start, the app checks that the selected port can bind and that the configured heap is reasonable. Before import, export, update, or restore, it requires the server to be offline.

## Security

The management API binds to loopback and uses a random per-install token between the WebView and API. WebView file access and unnecessary JavaScript bridges are disabled. Only bundled frontend origins may call privileged API routes.

Paper remains responsible for Minecraft authentication. The default generated configuration keeps `online-mode=true`. The app does not silently weaken authentication or expose the management panel publicly.

## Testing

Unit tests cover path validation, memory-limit calculation, command construction, runtime state transitions, log buffering, and setup recovery.

Android instrumentation tests cover first-run setup screens, notification creation, start and stop actions, WebView/API connectivity, file import/export, and state restoration after activity recreation.

Device validation requires a physical ARM64 Android device. The acceptance test runs Paper 1.21.11, connects a Minecraft client over Wi-Fi, turns the screen off for at least fifteen minutes, verifies the client remains connected, sends a console command, then performs a graceful shutdown and checks world files for a clean stop.

## Build And Deliverable

The repository gains a Gradle Android application module and reproducible debug APK build instructions. The first deliverable is a sideloadable ARM64 debug APK. A signed release APK requires a user-owned signing key and is a separate release step.

The implementation must not commit third-party runtime binaries whose redistribution terms are unclear. The selected JVM distribution and Paper download behavior must retain their required notices and licenses.
