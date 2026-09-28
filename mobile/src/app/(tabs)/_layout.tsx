import { NativeTabs } from "expo-router/unstable-native-tabs";
import { C } from "~/lib/theme";

export default function TabsLayout() {
  return (
    <NativeTabs tintColor={C.accent} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Record</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "mic", selected: "mic.fill" }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="history">
        <NativeTabs.Trigger.Label>History</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="clock.arrow.circlepath" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "gearshape", selected: "gearshape.fill" }} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
