# Android Paper Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a sideloadable ARM64 Android APK that installs and hosts Paper 1.21.11, keeps it running under a foreground service when the screen is off, and exposes the core DSM controls through a local WebView panel.

**Architecture:** Add a standalone Kotlin Android module under `android/`. The UI and loopback management API stay in the main app process; Paper runs in a dedicated `:paper` foreground-service process. That service loads a pinned Android OpenJDK 21 runtime through a small C/JNI `JLI_Launch` bridge, exchanges control and logs through AIDL, and holds CPU/Wi-Fi locks while running.

**Tech Stack:** Kotlin, Android SDK 36 with minSdk 29, Gradle Kotlin DSL, Android WebView, AIDL/Binder, CMake/NDK, `libjli.so`, Apache Commons Compress/XZ, JUnit 4, AndroidX Test.

---

## File Map

- `android/settings.gradle.kts`: standalone Android build definition.
- `android/build.gradle.kts`: Android and Kotlin plugin versions.
- `android/gradle.properties`: deterministic Gradle and AndroidX settings.
- `android/app/build.gradle.kts`: app dependencies, ABI filter, CMake, and asset packaging.
- `android/app/src/main/AndroidManifest.xml`: permissions, activity, provider, and `:paper` foreground service.
- `android/app/src/main/cpp/dsm_jvm_bridge.c`: pipes, runtime library loading, working directory, and `JLI_Launch`.
- `android/app/src/main/aidl/com/dreamy/servermanager/runtime/*.aidl`: cross-process runtime control and snapshots.
- `android/app/src/main/java/com/dreamy/servermanager/runtime/*`: JVM configuration, service, Binder client, state, logs, and locks.
- `android/app/src/main/java/com/dreamy/servermanager/setup/*`: device checks, runtime extraction, Paper download, and EULA setup.
- `android/app/src/main/java/com/dreamy/servermanager/panel/*`: loopback HTTP server and WebView activity.
- `android/app/src/main/java/com/dreamy/servermanager/storage/*`: safe paths, file operations, ZIP import/export.
- `android/app/src/main/assets/panel/*`: Android-focused DSM panel.
- `android/app/src/main/assets/runtime/*`: generated pinned JRE archives and notices; not edited manually.
- `android/scripts/prepare-runtime.ps1`: downloads the pinned Pojav APK and extracts only the Java 21 runtime component.
- `android/app/src/test/*`: JVM unit tests.
- `android/app/src/androidTest/*`: service, API, WebView, and setup instrumentation tests.
- `README.md`: Android preparation, build, install, and limitations.

### Task 1: Scaffold A Reproducible Android Build

**Files:**
- Create: `android/settings.gradle.kts`
- Create: `android/build.gradle.kts`
- Create: `android/gradle.properties`
- Create: `android/app/build.gradle.kts`
- Create: `android/app/src/main/AndroidManifest.xml`
- Create: `android/app/src/main/java/com/dreamy/servermanager/MainActivity.kt`
- Create: `android/app/src/main/res/values/strings.xml`
- Create: `android/app/src/main/res/values/themes.xml`
- Modify: `.gitignore`

- [ ] **Step 1: Write the build smoke test**

Create `android/app/src/test/java/com/dreamy/servermanager/BuildSmokeTest.kt`:

```kotlin
package com.dreamy.servermanager

import org.junit.Assert.assertEquals
import org.junit.Test

class BuildSmokeTest {
    @Test fun packageNameIsStable() {
        assertEquals("com.dreamy.servermanager", BuildConfig.APPLICATION_ID)
    }
}
```

- [ ] **Step 2: Run the test to verify the project is not configured yet**

Run: `cd android; .\gradlew.bat testDebugUnitTest`

Expected: FAIL because the Gradle wrapper/project does not exist.

- [ ] **Step 3: Add the Gradle project and minimal activity**

Use application id `com.dreamy.servermanager`, `compileSdk = 36`, `targetSdk = 35`, `minSdk = 29`, Kotlin JVM target 17, and `abiFilters += "arm64-v8a"`. Add AndroidX Core, AppCompat, Lifecycle Service, Commons Compress, XZ, JUnit 4, Kotlin Test, AndroidX Test, and Espresso dependencies. Configure CMake at `src/main/cpp/CMakeLists.txt` but leave the native target for Task 4.

The manifest must initially declare `INTERNET`, `WAKE_LOCK`, `ACCESS_WIFI_STATE`, `CHANGE_WIFI_MULTICAST_STATE`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE`, and `POST_NOTIFICATIONS`, plus an exported launcher activity.

Create a plain `MainActivity` that shows `Dreamy Server Manager` in a `TextView`. Add `.gradle/`, `local.properties`, `build/`, `*.apk`, and generated runtime assets to `.gitignore` while retaining runtime notice files.

- [ ] **Step 4: Generate the wrapper and run the unit test**

Run:

```powershell
& "$env:USERPROFILE\.gradle\wrapper\dists\gradle-8.14.3-all\10utluxaxniiv4wxiphsi49nj\gradle-8.14.3\bin\gradle.bat" -p android wrapper --gradle-version 8.14.3
cd android
.\gradlew.bat testDebugUnitTest
```

Expected: `BUILD SUCCESSFUL` and one passing test.

- [ ] **Step 5: Commit**

```powershell
git add .gitignore android
git commit -m "Scaffold Android host application"
```

### Task 2: Add Runtime State, Memory, Paths, And Launch Arguments

**Files:**
- Create: `android/app/src/main/java/com/dreamy/servermanager/runtime/RuntimeState.kt`
- Create: `android/app/src/main/java/com/dreamy/servermanager/runtime/RuntimeConfig.kt`
- Create: `android/app/src/main/java/com/dreamy/servermanager/runtime/JvmArguments.kt`
- Create: `android/app/src/main/java/com/dreamy/servermanager/storage/ServerPaths.kt`
- Test: `android/app/src/test/java/com/dreamy/servermanager/runtime/JvmArgumentsTest.kt`
- Test: `android/app/src/test/java/com/dreamy/servermanager/storage/ServerPathsTest.kt`

- [ ] **Step 1: Write failing configuration and path tests**

```kotlin
@Test fun clampsHeapAndBuildsHeadlessPaperArgs() {
    val config = RuntimeConfig(heapMb = 7000, deviceMemoryMb = 8192)
    assertEquals(4096, config.safeHeapMb)
    assertEquals(
        listOf("java", "-Xms512M", "-Xmx4096M", "-Djava.awt.headless=true", "-jar", "paper.jar", "nogui"),
        JvmArguments.forPaper(config)
    )
}

@Test fun rejectsTraversalOutsideServerRoot() {
    val root = temporaryFolder.newFolder("server")
    assertFailsWith<IllegalArgumentException> { ServerPaths.resolve(root, "../escape.txt") }
}
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd android; .\gradlew.bat testDebugUnitTest --tests "*JvmArgumentsTest" --tests "*ServerPathsTest"`

Expected: FAIL because the runtime classes do not exist.

- [ ] **Step 3: Implement the minimal domain layer**

Define `RuntimeState` values `NOT_INSTALLED`, `INSTALLING`, `OFFLINE`, `STARTING`, `RUNNING`, `STOPPING`, `CRASHED`, and `BLOCKED`. `RuntimeConfig.safeHeapMb` must clamp to `1024..4096` and never exceed `deviceMemoryMb - 1536`. `ServerPaths.resolve()` must normalize separators, reject absolute paths, compare canonical roots, and return only descendants of the server root.

Use this launch shape:

```kotlin
object JvmArguments {
    fun forPaper(config: RuntimeConfig): List<String> = listOf(
        "java",
        "-Xms512M",
        "-Xmx${config.safeHeapMb}M",
        "-Djava.awt.headless=true",
        "-jar",
        "paper.jar",
        "nogui",
    )
}
```

- [ ] **Step 4: Run tests**

Run: `cd android; .\gradlew.bat testDebugUnitTest`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add android/app/src/main android/app/src/test
git commit -m "Add Android runtime domain model"
```

### Task 3: Pin And Prepare The Android Java 21 Runtime

**Files:**
- Create: `android/scripts/prepare-runtime.ps1`
- Create: `android/runtime-lock.json`
- Create: `android/app/src/main/assets/licenses/POJAV-LGPL-3.0.txt`
- Create: `android/app/src/main/assets/licenses/OPENJDK-ASSEMBLY-EXCEPTION.txt`
- Create: `android/app/src/main/java/com/dreamy/servermanager/setup/RuntimeInstaller.kt`
- Test: `android/app/src/test/java/com/dreamy/servermanager/setup/RuntimeInstallerTest.kt`

- [ ] **Step 1: Write the failing runtime-layout test**

```kotlin
@Test fun mergesUniversalAndArm64ArchivesIntoJavaHome() {
    val installer = RuntimeInstaller(fakeArchiveReader, targetDir)
    installer.install()
    assertTrue(targetDir.resolve("lib/libjli.so").isFile)
    assertTrue(targetDir.resolve("lib/server/libjvm.so").isFile)
    assertTrue(targetDir.resolve("lib/modules").isFile)
}
```

- [ ] **Step 2: Run the test to verify failure**

Run: `cd android; .\gradlew.bat testDebugUnitTest --tests "*RuntimeInstallerTest"`

Expected: FAIL because `RuntimeInstaller` is missing.

- [ ] **Step 3: Add the pinned acquisition script and lock file**

Pin these verified inputs in `runtime-lock.json`:

```json
{
  "source": "https://github.com/PojavLauncherTeam/PojavLauncher/releases/download/gladiolus/PojavLauncher.apk",
  "sha256": "CC8479E1600E3A094D2184BBB88B19809CE41A0F8F7882AEFD4527C9D032FC56",
  "entries": [
    "assets/components/jre-21/universal.tar.xz",
    "assets/components/jre-21/bin-arm64.tar.xz",
    "assets/components/jre-21/version"
  ]
}
```

`prepare-runtime.ps1` must download to `android/.cache`, verify SHA-256 before opening the APK as ZIP, and copy only the three locked entries to `app/src/main/assets/runtime/jre21/`. It must fail if any entry or hash differs. Do not commit the generated archives.

- [ ] **Step 4: Implement atomic first-run extraction**

`RuntimeInstaller` must extract `universal.tar.xz` followed by `bin-arm64.tar.xz` into `files/runtime/jre21.tmp`, reject absolute and traversal archive entries, verify `lib/libjli.so`, `lib/server/libjvm.so`, and `lib/modules`, write the runtime version, then atomically rename the temporary directory to `files/runtime/jre21`.

- [ ] **Step 5: Run preparation and tests**

Run:

```powershell
.\android\scripts\prepare-runtime.ps1
cd android
.\gradlew.bat testDebugUnitTest
```

Expected: the three runtime assets exist locally, hashes match, and tests pass.

- [ ] **Step 6: Commit only source, lock, and notices**

```powershell
git add android/scripts android/runtime-lock.json android/app/src/main/assets/licenses android/app/src/main/java android/app/src/test .gitignore
git commit -m "Add pinned Android Java runtime preparation"
```

### Task 4: Launch Paper Through A Minimal JNI Bridge

**Files:**
- Create: `android/app/src/main/cpp/CMakeLists.txt`
- Create: `android/app/src/main/cpp/dsm_jvm_bridge.c`
- Create: `android/app/src/main/java/com/dreamy/servermanager/runtime/NativeJvmBridge.kt`
- Create: `android/app/src/main/java/com/dreamy/servermanager/runtime/JvmHost.kt`
- Test: `android/app/src/test/java/com/dreamy/servermanager/runtime/JvmHostTest.kt`

- [ ] **Step 1: Write the failing host-state test with a fake native bridge**

```kotlin
@Test fun reportsStartingRunningAndOfflineAroundNativeLaunch() {
    val states = mutableListOf<RuntimeState>()
    val host = JvmHost(FakeBridge(exitCode = 0), states::add)
    host.start(testLaunchRequest)
    host.awaitExit()
    assertEquals(listOf(RuntimeState.STARTING, RuntimeState.RUNNING, RuntimeState.OFFLINE), states)
}
```

- [ ] **Step 2: Run the test to verify failure**

Run: `cd android; .\gradlew.bat testDebugUnitTest --tests "*JvmHostTest"`

Expected: FAIL because `JvmHost` and its bridge interface are missing.

- [ ] **Step 3: Implement the native bridge**

Expose one JNI launch method:

```kotlin
external fun launch(
    args: Array<String>,
    javaHome: String,
    workingDirectory: String,
    stdinReadFd: Int,
    stdoutWriteFd: Int,
    stderrWriteFd: Int,
): Int
```

The C implementation must `dup2()` the supplied descriptors onto standard streams, `chdir()` into the server directory, set `JAVA_HOME`, `HOME`, `TMPDIR`, and `LD_LIBRARY_PATH`, preload `libjli.so`, `libjvm.so`, `libverify.so`, `libjava.so`, `libnet.so`, `libnio.so`, and `libzip.so` by absolute path, resolve `JLI_Launch` with `dlsym`, convert the Java string array to `argv`, invoke it, free allocations, and return the exit code. Link only `dl` and `log`.

Do not copy graphics, account, or Minecraft-client hooks from PojavLauncher. This server launcher needs no LWJGL/AWT rendering path.

- [ ] **Step 4: Implement pipe-backed `JvmHost`**

Create stdin, stdout, and stderr pipes with `ParcelFileDescriptor.createPipe()`. Launch JNI on one dedicated thread, read output on two bounded reader threads, append numbered log lines, and write console commands to the stdin pipe. `stop()` writes `stop\n`, waits 15 seconds, then asks the service process to terminate only if the JVM has not exited.

- [ ] **Step 5: Run unit and native builds**

Run:

```powershell
cd android
.\gradlew.bat testDebugUnitTest
.\gradlew.bat externalNativeBuildDebug
```

Expected: Kotlin tests pass and `libdsmjvm.so` builds for `arm64-v8a`.

- [ ] **Step 6: Commit**

```powershell
git add android/app/src/main/cpp android/app/src/main/java android/app/src/test android/app/build.gradle.kts
git commit -m "Add Android JNI Paper launcher"
```

### Task 5: Add Cross-Process Foreground Hosting

**Files:**
- Create: `android/app/src/main/aidl/com/dreamy/servermanager/runtime/IRuntimeService.aidl`
- Create: `android/app/src/main/aidl/com/dreamy/servermanager/runtime/RuntimeSnapshot.aidl`
- Create: `android/app/src/main/java/com/dreamy/servermanager/runtime/RuntimeSnapshot.kt`
- Create: `android/app/src/main/java/com/dreamy/servermanager/runtime/PaperHostService.kt`
- Create: `android/app/src/main/java/com/dreamy/servermanager/runtime/HostNotificationFactory.kt`
- Create: `android/app/src/main/java/com/dreamy/servermanager/runtime/RuntimeServiceClient.kt`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Test: `android/app/src/androidTest/java/com/dreamy/servermanager/runtime/PaperHostServiceTest.kt`

- [ ] **Step 1: Write the failing service test**

```kotlin
@Test fun startingHostCreatesOngoingNotification() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val notification = HostNotificationFactory(context).create(RuntimeState.RUNNING)
    assertTrue(notification.flags and Notification.FLAG_ONGOING_EVENT != 0)
    assertNotNull(notification.actions.firstOrNull { it.title == "Stop" })
}
```

- [ ] **Step 2: Run instrumentation compilation to verify failure**

Run: `cd android; .\gradlew.bat compileDebugAndroidTestKotlin`

Expected: FAIL because service/AIDL types are missing.

- [ ] **Step 3: Implement AIDL and the dedicated service process**

The AIDL interface must provide `startServer(heapMb)`, `sendCommand(command)`, `stopServer(force)`, `restartServer()`, and `getSnapshot(afterSequence, maxLines)`. `RuntimeSnapshot` contains state, PID, start time, exit code, latest sequence, and at most 200 log lines.

Declare the service with:

```xml
<service
    android:name=".runtime.PaperHostService"
    android:exported="false"
    android:foregroundServiceType="specialUse"
    android:process=":paper">
    <property
        android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
        android:value="User-started local Minecraft server hosting" />
</service>
```

- [ ] **Step 4: Add notification, wake lock, and Wi-Fi lock lifecycle**

Promote the service before JVM startup. The notification must show state and expose `Stop` through a service `PendingIntent`. Acquire a non-reference-counted partial wake lock and `WifiManager.WifiLock` only while `STARTING`, `RUNNING`, or `STOPPING`; release both in every exit/error path. Return `START_NOT_STICKY` so Android does not silently restart a potentially corrupt server after killing it.

- [ ] **Step 5: Build tests**

Run:

```powershell
cd android
.\gradlew.bat testDebugUnitTest compileDebugAndroidTestKotlin
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add android/app/src/main
git commit -m "Add foreground Paper hosting service"
```

### Task 6: Implement Setup, Paper Download, And EULA Acceptance

**Files:**
- Create: `android/app/src/main/java/com/dreamy/servermanager/setup/DeviceChecks.kt`
- Create: `android/app/src/main/java/com/dreamy/servermanager/setup/PaperApi.kt`
- Create: `android/app/src/main/java/com/dreamy/servermanager/setup/ServerInstaller.kt`
- Create: `android/app/src/main/java/com/dreamy/servermanager/setup/SetupState.kt`
- Test: `android/app/src/test/java/com/dreamy/servermanager/setup/PaperApiTest.kt`
- Test: `android/app/src/test/java/com/dreamy/servermanager/setup/ServerInstallerTest.kt`

- [ ] **Step 1: Write failing API and atomic-install tests**

```kotlin
@Test fun selectsLatestPaperBuildFor12111() {
    val response = """{"builds":[41,42,43]}"""
    assertEquals(43, PaperApi.parseLatestBuild(response))
}

@Test fun failedDownloadDoesNotReplaceExistingJar() {
    serverDir.resolve("paper.jar").writeText("valid")
    assertFails { installer.installPaper(failingSource) }
    assertEquals("valid", serverDir.resolve("paper.jar").readText())
}
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd android; .\gradlew.bat testDebugUnitTest --tests "*PaperApiTest" --tests "*ServerInstallerTest"`

Expected: FAIL because setup classes are missing.

- [ ] **Step 3: Implement device checks and official Paper API download**

Require `arm64-v8a`, API 29+, at least 3 GB total RAM, and at least 2 GB free app storage. Query the official Paper API for project `paper`, version `1.21.11`, choose the highest build, download to `paper.jar.part`, verify the API-provided SHA-256, then atomically replace `paper.jar`.

- [ ] **Step 4: Implement explicit EULA and resumable setup state**

Persist setup phases `DEVICE_CHECK`, `RUNTIME`, `PAPER`, `EULA`, and `READY`. Write `eula=true` only after a checked consent control whose label links to `https://aka.ms/MinecraftEULA`. Generate `server.properties` with `online-mode=true`, `server-port=25565`, `max-players=10`, and `view-distance=6` only when the file does not already exist.

- [ ] **Step 5: Run tests and commit**

Run: `cd android; .\gradlew.bat testDebugUnitTest`

Expected: PASS.

```powershell
git add android/app/src/main android/app/src/test
git commit -m "Add Android Paper setup flow"
```

### Task 7: Add The Loopback Management API

**Files:**
- Create: `android/app/src/main/java/com/dreamy/servermanager/panel/HttpRequest.kt`
- Create: `android/app/src/main/java/com/dreamy/servermanager/panel/HttpResponse.kt`
- Create: `android/app/src/main/java/com/dreamy/servermanager/panel/LocalPanelServer.kt`
- Create: `android/app/src/main/java/com/dreamy/servermanager/panel/PanelRoutes.kt`
- Create: `android/app/src/main/java/com/dreamy/servermanager/security/InstallToken.kt`
- Test: `android/app/src/test/java/com/dreamy/servermanager/panel/PanelRoutesTest.kt`

- [ ] **Step 1: Write failing route-authentication tests**

```kotlin
@Test fun rejectsApiRequestWithoutInstallToken() {
    val response = routes.handle(request("GET", "/api/runtime/status"))
    assertEquals(401, response.status)
}

@Test fun sendsCommandThroughRuntimeClient() {
    val response = routes.handle(authenticatedJson("POST", "/api/runtime/command", "{\"command\":\"list\"}"))
    assertEquals(204, response.status)
    assertEquals("list", fakeRuntime.lastCommand)
}
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd android; .\gradlew.bat testDebugUnitTest --tests "*PanelRoutesTest"`

Expected: FAIL because panel server classes are missing.

- [ ] **Step 3: Implement a bounded loopback HTTP server**

Bind a `ServerSocket` only to `127.0.0.1` on an ephemeral port. Limit request headers to 32 KB, JSON bodies to 1 MB, file uploads to 256 MB, and concurrent clients to eight. Serve bundled panel assets with fixed MIME types and `Cache-Control: no-store`.

Generate a random 256-bit install token in private preferences. The first top-level WebView request supplies `Authorization: Bearer <token>`; after validation, the server returns an `HttpOnly; SameSite=Strict` loopback session cookie derived from that token. Require the valid session cookie for every `/api/` route and reject non-loopback peers. This avoids exposing the long-lived token to page JavaScript while allowing same-origin `fetch()` calls.

- [ ] **Step 4: Implement core routes**

Add `GET /api/runtime/status`, `GET /api/runtime/logs?after=`, `POST /api/runtime/start`, `POST /api/runtime/stop`, `POST /api/runtime/restart`, `POST /api/runtime/command`, `GET /api/device`, `GET /api/properties`, and `PUT /api/properties`. Use structured JSON and return `409` for operations invalid in the current runtime state.

- [ ] **Step 5: Run tests and commit**

Run: `cd android; .\gradlew.bat testDebugUnitTest`

Expected: PASS.

```powershell
git add android/app/src/main android/app/src/test
git commit -m "Add loopback Android management API"
```

### Task 8: Build The Android DSM WebView Panel

**Files:**
- Create: `android/app/src/main/assets/panel/index.html`
- Create: `android/app/src/main/assets/panel/app.js`
- Create: `android/app/src/main/assets/panel/styles.css`
- Create: `android/app/src/main/java/com/dreamy/servermanager/panel/PanelActivity.kt`
- Create: `android/app/src/main/res/layout/activity_panel.xml`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Test: `android/app/src/androidTest/java/com/dreamy/servermanager/panel/PanelActivityTest.kt`

- [ ] **Step 1: Write the failing WebView smoke test**

```kotlin
@Test fun panelLoadsFromLoopbackAndShowsRuntimeStatus() {
    ActivityScenario.launch(PanelActivity::class.java).use {
        onWebView().withElement(findElement(Locator.ID, "runtime-status"))
            .check(webMatches(getText(), containsString("Offline")))
    }
}
```

- [ ] **Step 2: Run instrumentation compilation to verify failure**

Run: `cd android; .\gradlew.bat compileDebugAndroidTestKotlin`

Expected: FAIL because the panel activity and assets do not exist.

- [ ] **Step 3: Implement the focused mobile panel**

Reuse the existing DSM colors and component style, but include only `Console`, `Files`, `Properties`, and `Settings` for the first APK. The console page displays state, uptime, LAN address, Start/Stop/Restart, a bounded log view, and command input. Poll status/logs once per second only while the page is visible.

- [ ] **Step 4: Harden WebView configuration**

Load only the loopback URL returned by `LocalPanelServer`. Enable JavaScript and DOM storage, accept cookies only for the loopback origin, disable file/content access, reject navigation outside `127.0.0.1`, disable mixed content, and add the bearer token only to the initial request so the server can mint the HttpOnly session cookie. Do not add a JavaScript interface.

- [ ] **Step 5: Build tests and commit**

Run: `cd android; .\gradlew.bat testDebugUnitTest compileDebugAndroidTestKotlin`

Expected: PASS.

```powershell
git add android/app/src/main
git commit -m "Add mobile DSM WebView panel"
```

### Task 9: Add Safe File Editing, Import, And Export

**Files:**
- Create: `android/app/src/main/java/com/dreamy/servermanager/storage/ServerFileManager.kt`
- Create: `android/app/src/main/java/com/dreamy/servermanager/storage/ServerArchive.kt`
- Create: `android/app/src/main/java/com/dreamy/servermanager/storage/DocumentActions.kt`
- Modify: `android/app/src/main/java/com/dreamy/servermanager/panel/PanelRoutes.kt`
- Modify: `android/app/src/main/java/com/dreamy/servermanager/panel/PanelActivity.kt`
- Test: `android/app/src/test/java/com/dreamy/servermanager/storage/ServerArchiveTest.kt`

- [ ] **Step 1: Write failing ZIP traversal and offline-gate tests**

```kotlin
@Test fun rejectsZipEntryOutsideServerDirectory() {
    val zip = zipWithEntry("../../escape.txt", "bad")
    assertFailsWith<IllegalArgumentException> { archive.import(zip.inputStream()) }
}

@Test fun refusesExportWhileServerIsRunning() {
    assertFailsWith<IllegalStateException> { archive.export(output, RuntimeState.RUNNING) }
}
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd android; .\gradlew.bat testDebugUnitTest --tests "*ServerArchiveTest"`

Expected: FAIL because archive support is missing.

- [ ] **Step 3: Implement server-root-scoped file operations**

Add list, read text, write text atomically, mkdir, rename, delete, and upload. Reuse `ServerPaths.resolve()` for every request. Reject symlink traversal, files over 10 MB in the text editor, and edits to world files while Paper is running.

- [ ] **Step 4: Implement Storage Access Framework import/export**

Use `ACTION_OPEN_DOCUMENT`, `ACTION_OPEN_DOCUMENT_TREE`, and `ACTION_CREATE_DOCUMENT`; request no broad storage permission. ZIP import and export require `OFFLINE`, stream data without loading the full archive into RAM, reject traversal and symlinks, and write export metadata compatible with `dsm-server-export-v1`.

- [ ] **Step 5: Add file routes and run tests**

Add `GET /api/files`, `GET/PUT/DELETE /api/file`, `POST /api/directory`, and native document-picker callbacks for upload/import/export.

Run: `cd android; .\gradlew.bat testDebugUnitTest compileDebugAndroidTestKotlin`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add android/app/src/main android/app/src/test
git commit -m "Add Android server file management"
```

### Task 10: Add Permissions, Battery Guidance, And Network Status

**Files:**
- Create: `android/app/src/main/java/com/dreamy/servermanager/system/PermissionCoordinator.kt`
- Create: `android/app/src/main/java/com/dreamy/servermanager/system/BatteryOptimization.kt`
- Create: `android/app/src/main/java/com/dreamy/servermanager/system/NetworkAddresses.kt`
- Modify: `android/app/src/main/java/com/dreamy/servermanager/MainActivity.kt`
- Modify: `android/app/src/main/assets/panel/app.js`
- Test: `android/app/src/test/java/com/dreamy/servermanager/system/NetworkAddressesTest.kt`

- [ ] **Step 1: Write the failing address-filter test**

```kotlin
@Test fun exposesOnlyUsableLanAddresses() {
    val result = NetworkAddresses.filter(listOf("127.0.0.1", "169.254.1.2", "192.168.1.42", "10.0.0.7"))
    assertEquals(listOf("192.168.1.42", "10.0.0.7"), result)
}
```

- [ ] **Step 2: Run the test to verify failure**

Run: `cd android; .\gradlew.bat testDebugUnitTest --tests "*NetworkAddressesTest"`

Expected: FAIL because the system helpers are missing.

- [ ] **Step 3: Implement user-initiated permission and battery flows**

Request notification permission immediately before the first server start on Android 13+. Show an explanation and deep-link to `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` only after an explicit user action. Also provide the ordinary app battery-settings page when direct exemption is unavailable. Never start hosting from the background or on boot.

- [ ] **Step 4: Show realistic network and resource warnings**

Display LAN addresses with port `25565`, label them `Rede local`, and state that public internet access requires router/VPN/tunnel configuration. Show charger, heat, and low-memory warnings without blocking a capable device.

- [ ] **Step 5: Run tests and commit**

Run: `cd android; .\gradlew.bat testDebugUnitTest compileDebugAndroidTestKotlin`

Expected: PASS.

```powershell
git add android/app/src/main android/app/src/test
git commit -m "Add Android hosting readiness guidance"
```

### Task 11: Build, Install, And Verify The APK

**Files:**
- Create: `android/app/src/androidTest/java/com/dreamy/servermanager/HostingFlowTest.kt`
- Modify: `README.md`
- Create: `android/THIRD_PARTY_NOTICES.md`

- [ ] **Step 1: Add an instrumentation setup smoke test**

```kotlin
@Test fun setupReachesReadyWithPreparedRuntimeAndFakePaperDownload() {
    launchSetupWithFixtures()
    onView(withId(R.id.accept_eula)).perform(click())
    onView(withId(R.id.continue_button)).perform(click())
    onView(withText("Servidor pronto")).check(matches(isDisplayed()))
}
```

- [ ] **Step 2: Run the full automated verification**

Run:

```powershell
.\android\scripts\prepare-runtime.ps1
cd android
.\gradlew.bat clean testDebugUnitTest assembleDebug
```

Expected: all unit tests pass and `android/app/build/outputs/apk/debug/app-debug.apk` exists with `arm64-v8a` native libraries and the two generated runtime archives.

- [ ] **Step 3: Inspect APK contents and size**

Run:

```powershell
jar tf app\build\outputs\apk\debug\app-debug.apk | Select-String 'lib/arm64-v8a/libdsmjvm.so|assets/runtime/jre21|assets/licenses'
Get-Item app\build\outputs\apk\debug\app-debug.apk | Select-Object FullName,Length
```

Expected: JNI bridge, runtime archives, and notices are present; no x86/armeabi native directories exist.

- [ ] **Step 4: Install and run device acceptance when an ARM64 device is attached**

Run:

```powershell
& "$env:ANDROID_HOME\platform-tools\adb.exe" install -r app\build\outputs\apk\debug\app-debug.apk
& "$env:ANDROID_HOME\platform-tools\adb.exe" shell am start -n com.dreamy.servermanager/.MainActivity
```

Accept the EULA, install Paper, start the server, join from a Minecraft 1.21.11 client over Wi-Fi, turn the screen off for fifteen minutes, run `list` from the panel, then stop gracefully. Capture `adb logcat`, the final runtime state, and the Paper `logs/latest.log`. If no physical ARM64 device is attached, report this acceptance test as not run rather than claiming it passed.

- [ ] **Step 5: Document build and operational limits**

Add exact preparation/build/install commands, minimum device requirements, local-network connection steps, battery exemption guidance, runtime/Pojav/OpenJDK notices, and the explicit limits around heat, low-memory kills, OEM firmware, NAT, and force-stop.

- [ ] **Step 6: Run final verification and commit**

Run:

```powershell
cd android
.\gradlew.bat clean testDebugUnitTest assembleDebug
cd ..
git diff --check
git status --short
```

Expected: build succeeds, tests have zero failures, diff check is clean, and only intended files or generated ignored files remain.

```powershell
git add README.md android
git commit -m "Build Android Paper hosting APK"
```
