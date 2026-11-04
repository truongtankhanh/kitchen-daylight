// The only route: the working app name, nothing else until the mobile shell slice.
import { catalogues, DEFAULT_LOCALE } from '@kd/i18n';
import { useTheme } from 'expo-router';
import { Text } from 'react-native';

export default function Index() {
  const { colors } = useTheme();
  return <Text style={{ color: colors.text }}>{catalogues[DEFAULT_LOCALE].common.appName}</Text>;
}
