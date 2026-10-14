import { Tabs } from 'expo-router';
import { colors } from '../../src/components/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarIconStyle: { display: 'none' },
        tabBarLabelStyle: { fontSize: 14 },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Catalog' }} />
      <Tabs.Screen name="scenes" options={{ title: 'Scenes' }} />
      <Tabs.Screen name="favorites" options={{ title: 'Favorites' }} />
    </Tabs>
  );
}
