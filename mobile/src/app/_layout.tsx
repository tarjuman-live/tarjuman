import { useEffect } from "react";
import { ConvexReactClient, useConvexAuth } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import * as SecureStore from "expo-secure-store";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import { CONVEX_URL } from "~/lib/config";
import { C } from "~/lib/theme";

SplashScreen.preventAutoHideAsync();

// Same Convex deployment as the web app — sessions recorded on the phone show
// up on tarjuman.live and vice versa.
const convex = new ConvexReactClient(CONVEX_URL, { unsavedChangesWarning: false });

// Auth tokens live in the iOS Keychain, not plain AsyncStorage.
const secureStorage = {
  getItem: SecureStore.getItemAsync,
  setItem: SecureStore.setItemAsync,
  removeItem: SecureStore.deleteItemAsync,
};

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: C.accent,
    background: C.bg,
    card: C.bg,
    text: C.w,
    border: C.border,
  },
};

export default function RootLayout() {
  return (
    <ConvexAuthProvider client={convex} storage={secureStorage}>
      <ThemeProvider value={theme}>
        <StatusBar style="light" />
        <AuthGate />
      </ThemeProvider>
    </ConvexAuthProvider>
  );
}

function AuthGate() {
  const { isLoading, isAuthenticated } = useConvexAuth();

  useEffect(() => {
    if (!isLoading) void SplashScreen.hideAsync();
  }, [isLoading]);

  if (isLoading) return null;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }}>
      <Stack.Protected guard={isAuthenticated}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="session/[id]"
          options={{
            headerShown: true,
            headerTitle: "",
            headerBackButtonDisplayMode: "minimal",
            headerTransparent: true,
            headerTintColor: C.w,
          }}
        />
      </Stack.Protected>
      <Stack.Protected guard={!isAuthenticated}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}
