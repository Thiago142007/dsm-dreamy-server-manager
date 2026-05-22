const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("dsmDesktop", {
  environment: "desktop",
});
