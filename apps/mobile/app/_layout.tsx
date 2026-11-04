// Root layout: the theme provider fed by @kd/design-tokens and one stack for the single route.
import { darkTheme, lightTheme } from '@kd/design-tokens/react-native';
import type { ColorSchemeTheme } from '@kd/design-tokens/react-native';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import type { Theme } from 'expo-router';
import { useColorScheme } from 'react-native';

function toNavigationTheme(tokens: ColorSchemeTheme, base: Theme): Theme {
  return {
    ...base,
    dark: tokens.dark,
    colors: {
      primary: tokens.colors.primary,
      background: tokens.colors.bg,
      card: tokens.colors.surface,
      text: tokens.colors.text,
      border: tokens.colors.divider,
      notification: tokens.colors.error,
    },
  };
}

const themes = {
  light: toNavigationTheme(lightTheme, DefaultTheme),
  dark: toNavigationTheme(darkTheme, DarkTheme),
} as const;

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? themes.dark : themes.light}>
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
