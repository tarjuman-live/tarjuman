/**
 * Adopt the UIScene life cycle — REQUIRED by the iOS 27 SDK, which kills an
 * app at launch ("UIScene life cycle is required for apps built with this
 * SDK") if it still creates its window in the app delegate.
 *
 * The SDK 57 prebuild template predates this; Expo already ships the runtime
 * piece (ExpoAppSceneDelegate) and SDK 58's template wires it up exactly like
 * this plugin does. Delete this plugin when upgrading to SDK 58+.
 */
const fs = require("fs");
const path = require("path");
const {
  IOSConfig,
  withAppDelegate,
  withDangerousMod,
  withInfoPlist,
  withXcodeProject,
} = require("expo/config-plugins");

const SCENE_DELEGATE = `internal import Expo

@objc(SceneDelegate)
class SceneDelegate: ExpoAppSceneDelegate {
  // Extension point for config plugins.
}
`;

module.exports = function withSceneLifecycle(config) {
  config = withInfoPlist(config, (c) => {
    c.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate",
          },
        ],
      },
    };
    return c;
  });

  config = withAppDelegate(config, (c) => {
    let src = c.modResults.contents;
    src = src.replace(
      "class AppDelegate: ExpoAppDelegate {",
      "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {",
    );
    // The scene delegate creates the window and starts React Native now.
    src = src.replace(
      /#if os\(iOS\) \|\| os\(tvOS\)\s*\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)[\s\S]*?#endif\n/,
      "    // Window + React Native start live in SceneDelegate (iOS 27 scene life cycle).\n",
    );
    c.modResults.contents = src;
    return c;
  });

  config = withDangerousMod(config, [
    "ios",
    (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, c.modRequest.projectName);
      fs.writeFileSync(path.join(dir, "SceneDelegate.swift"), SCENE_DELEGATE);
      return c;
    },
  ]);

  config = withXcodeProject(config, (c) => {
    const name = c.modRequest.projectName;
    const file = `${name}/SceneDelegate.swift`;
    if (!c.modResults.hasFile(file)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath: file,
        groupName: name,
        project: c.modResults,
      });
    }
    return c;
  });

  return config;
};
