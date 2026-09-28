// Metro config for the Tarjuman iOS app.
//
// The app shares pure-TypeScript modules with the web app (../src/lib — the
// Speechmatics session core, DSP chain, translate client, speaker lock,
// constants) and the Convex API types (../convex/_generated). Metro only sees
// files under watchFolders, so the repo root is added; node_modules resolve
// from this app first so there is exactly one React / React Native.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [repoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(repoRoot, "node_modules"),
];
// Never bundle the web app's build output or its node_modules copies of RN.
config.resolver.blockList = [
  new RegExp(`${repoRoot}/\\.next/.*`),
  new RegExp(`${repoRoot}/node_modules/react-native/.*`),
];

module.exports = config;
