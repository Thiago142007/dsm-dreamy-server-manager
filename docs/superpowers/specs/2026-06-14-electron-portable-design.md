# Dreamy Server Manager Electron Portable Design

## Objective

Distribute Dreamy Server Manager as a single Windows portable executable. The user must be able to run the application without installing it and move the executable together with its data folder to another Windows computer.

## Packaging

- Use Electron Builder's `portable` Windows target for x64.
- Produce `Dreamy Server Manager.exe` in `dist-electron`.
- Keep the existing Electron main process and local HTTP backend architecture.
- Do not produce or require an NSIS installer for the portable build.

## Portable Data Location

In a packaged portable build, create and use `Dreamy Server Manager Data` beside the portable executable. This folder is the storage root for:

- `data`, including accounts and application configuration;
- `server`, including Minecraft server files;
- managed Java runtimes and other application-managed persistent files stored below those roots.

In development, continue using the project working directory so `npm run desktop` remains convenient and does not write into Electron's installation directory.

The application must resolve the executable directory from Electron Builder's portable runtime environment when available, with `process.execPath` as the packaged fallback. Directory resolution will live in a small testable module rather than being embedded in window startup code.

## Desktop Startup

The Electron main process will:

1. Resolve and create the portable data directory.
2. Start the existing DSM backend using `data` and `server` inside that directory.
3. Request port `0`, allowing Windows to allocate a free loopback port and avoiding conflicts with services already using port 3000.
4. Load the backend URL in the Electron window.
5. Stop the backend cleanly when the application exits.

The backend remains bound to `127.0.0.1`; it must not expose the desktop application to the local network.

## Failure Handling

- If storage initialization or backend startup fails, show a desktop error dialog with the useful error details and terminate cleanly.
- Keep existing handlers for unexpected exceptions and rejected promises.
- External links continue opening in the system browser rather than inside the Electron window.

## Tests And Verification

- Add focused automated tests for development and packaged portable data-path resolution.
- Add or update tests confirming that port `0` produces a usable loopback backend URL.
- Run the complete Node test suite.
- Build the portable x64 executable with Electron Builder.
- Launch the generated executable and verify that the DSM window loads and `Dreamy Server Manager Data` is created beside it.

## Out Of Scope

- Code signing and Windows publisher certificates.
- Auto-update support.
- macOS or Linux packages.
- Redesigning the existing DSM interface or backend features.
